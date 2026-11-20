import { it } from 'vitest';
import { layout } from '../../src/panels/_diagram/layout';
import { groupMinSize } from '../../src/panels/_diagram/groups';

it('probe', async () => {
  const min = groupMinSize('public subnet', '10.0.1.0/24', {}, undefined);
  console.log('min', JSON.stringify(min));
  const p = await layout(
    [
      { id: 'a', ...min },
      { id: 'n', width: 112, height: 62, parent: 'a' },
    ],
    [],
    'DOWN',
  );
  console.log(JSON.stringify(p));
});
