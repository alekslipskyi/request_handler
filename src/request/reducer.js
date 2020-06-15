const initialState = { notDoneRequests: [] };

const ADD_REQUEST_TO_QUEUE = 'core/ADD_REQUEST_TO_QUEUE';
const REMOVE_REQUEST_FROM_QUEUE = 'core/REMOVE_REQUEST_TO_QUEUE';

const prioritize = requests => requests.sort((prevReq, nextReq) => nextReq.priority - prevReq.priority);

export default function core(state = initialState, action) {
	switch (action.type) {
		case ADD_REQUEST_TO_QUEUE:
			return { ...state, notDoneRequests: prioritize([...state.notDoneRequests, action.data]) };
		case REMOVE_REQUEST_FROM_QUEUE:
			return { ...state, notDoneRequests: state.notDoneRequests.filter(req => req.requestId !== action.requestId) };
		default:
			return state;
	}
}

export const addRequestToQueue = (requestId, data) => ({
	type: ADD_REQUEST_TO_QUEUE,
	data: { ...data, requestId },
});

export const removeRequestFromQueue = requestId => ({
	type: REMOVE_REQUEST_FROM_QUEUE,
	requestId,
});