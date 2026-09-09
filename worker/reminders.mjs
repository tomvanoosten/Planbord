import {tick} from '../server/backend.mjs';
export default {
  async scheduled(event,env,context) { context.waitUntil(tick(env)); }
};
