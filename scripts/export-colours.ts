import { writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { demoColours } from './demo-colours';

// Demo files reach panel code, which imports stylesheets. Outside a bundler those are empty.
register(
  `data:text/javascript,${encodeURIComponent(
    `export async function load(url, context, next) {
       if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
       return next(url, context);
     }`,
  )}`,
);
const { plainDemos } = await import('../src/walkthroughs');

const target = 'src/walkthroughs/colours.generated.json';
writeFileSync(target, `${JSON.stringify(await demoColours(plainDemos))}\n`);
console.log(`wrote ${target}`);
