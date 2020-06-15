import RequestHandler from './request/handler';
import requestReducer from './request/reducer';

const requestMiddleware = config => {
	return ({ dispatch, getState }) => next => action => {
		if (action.request) return new RequestHandler(dispatch, action, getState, next, config).send();
		return next(action);
	};
};

export { requestMiddleware, requestReducer };