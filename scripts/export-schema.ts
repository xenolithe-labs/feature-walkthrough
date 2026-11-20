import { mkdirSync, writeFileSync } from 'node:fs';
import { configJsonSchema } from '../src/core/schema';
import { checkResultJsonSchema } from '../src/review/schema';

mkdirSync('schema', { recursive: true });
writeFileSync('schema/walkthrough.schema.json', `${JSON.stringify(configJsonSchema(), null, 2)}\n`);
console.log('wrote schema/walkthrough.schema.json');
writeFileSync(
  'schema/check-result.schema.json',
  `${JSON.stringify(checkResultJsonSchema(), null, 2)}\n`,
);
console.log('wrote schema/check-result.schema.json');
