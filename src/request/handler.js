import axios from 'axios';
import omit from 'lodash.omit';
import get from 'lodash.get';
import { addRequestToQueue, removeRequestFromQueue } from './reducer';

export default class HttpRequestHandler {
	static reservedKeys = [
		'types', 'type', 'requestId', 'request', 'data', 'origin',
		'actionsAfterSuccess', 'isAuthReq', 'before', 'isEnsureToSend', 'afterFailed',
	];

	static defaultConfig = {
		hooks: {},
		defaultPayload: {
			inProgress: {},
			success: {},
			failed: {}
		}
	};

	constructor(dispatch, action, getState, next, config = HttpRequestHandler.defaultConfig) {
		const { types, type } = action;

		this.requestState = types
			? {
				START: types[0],
				SUCCESS: types[1] || type,
				FAILED: types[2],
			}
			: {
				SUCCESS: type,
			};
		this.action = action;
		this.dispatch = dispatch;
		this.getState = getState;
		this.config = { ...HttpRequestHandler.defaultConfig, ...config };
		this.next = next;

		const axiosConfig = {};

		if (action.isAuthReq && get(getState(), config.pathToToken)) {
			axiosConfig.headers = {
				"Authorization": `Bearer ${get(getState(), config.pathToToken)}`
			}
		}

		this.axiosConfig = axiosConfig;

		this.agent = axios.create({ baseURL: config.apiUrl || '', ...axiosConfig });
	}

	generateRequestId = (length = 14) => Math.random().toString(length).replace('0.', '');

	fireAnotherActions = actions => setTimeout(() => Promise.all(actions.map(action => this.dispatch(action))), 0);

	buildRequest = async () => {
		const { agent, getState, action, dispatch } = this;
		const { request } = action;

		return request(agent, { getState, dispatch });
	};

	parseActionsAfterSuccess = actions => {
		function parse(act) {
			act.map(action => {
				const newAction = action;
				if (newAction.request) newAction.request = newAction.request.toString();
				if (newAction.actionsAfterSuccess) parse(newAction.actionsAfterSuccess);
			});
		}

		parse(actions);

		return actions;
	};

	addRequestToQueue = async (err) => {
		const { actionsAfterSuccess, isSilentRequest, after, before, reducer } = this.action;

		const requestId = this.generateRequestId();
		let copiedRequest = {
			...omit(this.action, ['request', 'after', 'before', 'afterFailed']),
			preferRequest: { ...err.config, data: JSON.stringify(omit(JSON.parse(err.config.data || '{}'))) },
		};

		if (reducer) {
			if (after) copiedRequest.after = after.name;
			if (before) copiedRequest.before = before.name;
		}

		if (actionsAfterSuccess) this.parseActionsAfterSuccess(actionsAfterSuccess);
		if (isSilentRequest) {
			copiedRequest = {
				preferRequest: copiedRequest.preferRequest,
			};
		}

		this.dispatch(addRequestToQueue(requestId, copiedRequest));
	};

	ensureToSend = (requestId) => this.agent.interceptors.response.use(
		res => {
			if (requestId) this.dispatch(removeRequestFromQueue(requestId));
			return res;
		}, async err => {
			try {
				if (!requestId && err && err.message === 'Network Error') {
					await this.addRequestToQueue(err);
				} else if (requestId) this.dispatch(removeRequestFromQueue(requestId));
			} catch (err) {
				if (requestId) this.dispatch(removeRequestFromQueue(requestId));
			}

			return Promise.reject(err);
		},
	);

	getDataFromAction = () => omit(this.action, HttpRequestHandler.reservedKeys);

	dataToTarget = data => {
		if (this.action.target) {
			return { [this.action.target]: data };
		}

		return data;
	};

	send = async () => {
		const { requestState, getState, action, dispatch, config, agent } = this;
		const { requestId, actionsAfterSuccess, before, isEnsureToSend, origin, onFailedRequest } = action;

		if (origin) this.agent = axios.create({ baseURL: origin, ...this.axiosConfig });

		if (config.hooks.before) config.hooks.before({ action, getState, dispatch, agent });
		if (before) before(getState(), dispatch);

		if (isEnsureToSend) this.ensureToSend(requestId);

		if (requestState.START) {
			this.next({
				type: requestState.START,
				data: this.dataToTarget(config.defaultPayload.inProgress),
				...this.getDataFromAction(),
			});
		}

		try {
			const response = await this.buildRequest();

			const data =
				this.action.target
					? this.dataToTarget({ response: response.data, ...config.defaultPayload.success })
					: response.data;
			if (actionsAfterSuccess) this.fireAnotherActions(actionsAfterSuccess);
			if (requestState.SUCCESS) this.next({ type: requestState.SUCCESS, data, ...this.getDataFromAction() });

			if (config.hooks.after) config.hooks.after({ data, getState, dispatch });
			if (action.onSuccessRequest && response.status < 300) action.onSuccessRequest({ data, store: { getState, dispatch } });
			if (onFailedRequest && response.status >= 400) onFailedRequest({ response, store: { getState, dispatch } });

			return data;
		} catch (err) {
			if (config.hooks.afterFailed) config.hooks.afterFailed({ err, getState, dispatch });
			if (onFailedRequest) onFailedRequest({ response: err.request, store: { getState, dispatch } })

			if (requestState.FAILED) {
				this.next({
					type: requestState.FAILED,
					...(
						err.request ? {
							status: err.request.status,
							message: err.request.statusText,
							body: err.request.body,
						} : {}
					),
					data: this.dataToTarget({
						...config.defaultPayload.failed,
					}),
					...this.getDataFromAction(),
				});
			} else if (err.request) {
				this.next({
					type: "common/REQUEST_FAILED",
					status: err.request.status,
					message: err.request.statusText,
					body: err.request.body
				});
			}

			return Promise.reject(err);
		}
	}
}
