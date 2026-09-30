import { runWebGLBench } from '../benchWebGL';
import { benchOptionsFromQuery, publish } from '../benchRunner';

runWebGLBench(document.body, benchOptionsFromQuery(location.search))
  .then(publish)
  .catch((e: unknown) => publish({ error: String(e) }));
