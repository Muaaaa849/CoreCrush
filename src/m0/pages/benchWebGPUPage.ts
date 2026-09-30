import { runWebGPUBench } from '../benchWebGPU';
import { benchOptionsFromQuery, publish } from '../benchRunner';

const forceWebGL = new URLSearchParams(location.search).get('forceWebGL') === '1';
runWebGPUBench(document.body, forceWebGL, benchOptionsFromQuery(location.search))
  .then(publish)
  .catch((e: unknown) => publish({ error: String(e) }));
