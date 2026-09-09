import {api} from '../../server/backend.mjs';
export const onRequest = context => api(context.request,context.env,context);
