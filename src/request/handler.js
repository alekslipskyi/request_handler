import axios from 'axios';
import omit from 'lodash.omit';
import { addRequestToQueue, removeRequestFromQueue } from './reducer';

export default class HttpRequestHandler {
	static reservedKeys = [
		'types', 'type', 'requestId', 'request', 'data',
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
		this.config = config;
		this.next = next;
		this.agent = axios.create({ baseURL: config.apiUrl || '' });
	}

	convertFn = fn => {
		const { action, reducers } = this;
		const { reducer } = action;

		if (reducer && typeof fn === 'string') {
			return reducers[reducer][fn];
		}

		return fn;
	};

	generateRequestId = (length = 14) => Math.random().toString(length).replace('0.', '');

	fireAnotherActions = actions => setTimeout(() => Promise.all(actions.map(action => this.dispatch(action))), 0);

	buildRequest = async () => {
		const { agent, getState, action, dispatch } = this;
		const { request, after, preferRequest } = action;
		let response;
		const req = await (preferRequest ? agent.request(preferRequest) : request(agent, getState, dispatch));

		if (after) {
			response = await this.convertFn(after)(req, this.dispatch, this.getState);

			if (!response) response = req;
		} else response = req;

		return response;
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
		const { requestId, actionsAfterSuccess, before, isEnsureToSend, afterFailed } = action;

		if (config.hooks.before) config.hooks.before({ action, getState, dispatch, agent });
		if (before) this.agent.interceptors.request(this.convertFn(before)(dispatch, getState));

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
			response.data = response.data || {};

			const data = this.dataToTarget({ ...response.data, ...config.defaultPayload.success });
			if (actionsAfterSuccess) this.fireAnotherActions(actionsAfterSuccess);
			if (requestState.SUCCESS) this.next({ type: requestState.SUCCESS, data, ...this.getDataFromAction() });

			if (config.hooks.after) config.hooks.after({ data, getState, dispatch });
			if (config.hooks.afterSuccess) config.hooks.afterSuccess({ data, getState, dispatch });

			return data;
		} catch (err) {
			if (config.hooks.afterFailed) config.hooks.afterFailed({ err, getState, dispatch });
			if (afterFailed) afterFailed(this.dispatch, this.getState);

			if (requestState.FAILED) {
				this.next({
					type: requestState.FAILED,
					data: this.dataToTarget({
						...config.defaultPayload.failed,
					}),
					...this.getDataFromAction(),
				});
			}

			return Promise.reject(err);
		}
	}
}
