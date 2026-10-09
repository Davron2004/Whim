/**
 * The child process `data-copy-crash.suite.ts` SIGKILLs mid-copy: one real store copy through the
 * Node copy seam, then "done" on stdout. Bundled by that suite at run time; never imported.
 *
 *   node <bundle> <storage dir> <from appId> <to appId>
 */

import { createNodeCopyStorage } from '../../storage-engine/copy-node';

const [dir, from, to] = process.argv.slice(2);
await createNodeCopyStorage(dir)({ from, to });
process.stdout.write('done\n');
