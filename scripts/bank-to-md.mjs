// Ubah berkas bank soal JSON menjadi Markdown yang mudah ditinjau (berisi KUNCI JAWABAN — simpan privat).
// Pemakaian: node scripts/bank-to-md.mjs content-private/bank-soal/nama.json > content-private/bank-soal/nama.md
import { readFileSync } from 'node:fs';

const bank = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = [];
const L = 'ABCDEF';
out.push(`# ${bank.judul ?? 'Bank soal'}`, '');
if (bank.sumber) out.push(`**Sumber:** ${bank.sumber}`, '');
if (bank.catatan) out.push(`> ${bank.catatan}`, '');
const mcq = bank.questions.filter((q) => q.type === 'mcq');
const essay = bank.questions.filter((q) => q.type === 'essay');
out.push(`Total: ${mcq.length} pilihan ganda, ${essay.length} esai.`, '', '## A. Pilihan ganda', '');
mcq.forEach((q, i) => {
  out.push(`**${i + 1}. ${q.stem}**  `, `_Topik: ${q.topic} · tingkat ${q.difficulty} · ${q.points} poin_`, '');
  q.options.forEach((o, j) => out.push(`${L[j]}. ${o.body}${o.isCorrect ? ' ✅' : ''}  `));
  out.push('');
});
out.push('## B. Esai', '');
essay.forEach((q, i) => {
  out.push(`**${i + 1}. ${q.stem}**  `, `_Topik: ${q.topic} · tingkat ${q.difficulty} · ${q.points} poin_`, '');
  out.push('Rubrik: ' + q.rubric.map((r) => `${r.criterion} (0–${r.maxScore})`).join('; ') + '  ');
  out.push(`Contoh jawaban: ${q.modelAnswer}`, '');
});
process.stdout.write(out.join('\n'));
