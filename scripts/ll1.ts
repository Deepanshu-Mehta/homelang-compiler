/** Prints FIRST and FOLLOW and proves the grammar is LL(1). Run: npm run ll1 */
import { analyzeGrammar } from '../src/compiler/parser/ll1';

const { first, follow, conflicts, table } = analyzeGrammar();

for (const name of Object.keys(first)) {
  console.log(`${name}\n  FIRST:  ${first[name]!.join(' ')}\n  FOLLOW: ${follow[name]!.join(' ')}`);
}

console.log(`\nParse table entries: ${table.length}`);
if (conflicts.length === 0) {
  console.log('LL(1) conflicts: 0. The grammar is LL(1).');
} else {
  console.log(`LL(1) conflicts: ${conflicts.length}`);
  for (const c of conflicts) console.log(`  ${c.nonterminal}: ${c.reason} [${c.tokens.join(' ')}]`);
  process.exitCode = 1;
}
