// Writes examples/use-case/stress.json: a hospital system with 2 subjects,
// 9 actors, 40 use cases and about 70 relationships.
//   node scripts/generate-use-case-stress.mjs > examples/use-case/stress.json
const elements = [], relationships = [];
const actor = (id, name, extra = {}) => elements.push({ id, type: 'actor', name, ...extra });
const uc = (id, name, subject, extra = {}) => elements.push({ id, type: 'useCase', name, subject, ...extra });
const rel = (type, from, to, extra = {}) => relationships.push({ type, from, to, ...extra });

elements.push({ id: 'clinic', type: 'subject', name: 'Clinical system' }, { id: 'billing', type: 'subject', name: 'Billing system', stereotypes: ['subsystem'] });
actor('patient', 'Patient');
actor('outpatient', 'Outpatient');
actor('doctor', 'Doctor');
actor('surgeon', 'Surgeon');
actor('nurse', 'Nurse');
actor('clerk', 'Front desk clerk');
actor('lab', 'Laboratory', { stereotypes: ['system'] });
actor('insurer', 'Insurance company', { stereotypes: ['system'] });
actor('bank', 'Payment provider', { stereotypes: ['system'] });
rel('generalization', 'outpatient', 'patient');
rel('generalization', 'surgeon', 'doctor');

const clinical = [
  ['book', 'Book appointment', 'patient'], ['cancelAppt', 'Cancel appointment', 'patient'], ['checkin', 'Check in', 'clerk'],
  ['register', 'Register patient', 'clerk'], ['triage', 'Triage patient', 'nurse'], ['vitals', 'Record vital signs', 'nurse'],
  ['examine', 'Examine patient', 'doctor'], ['diagnose', 'Record diagnosis', 'doctor'], ['prescribe', 'Prescribe medication', 'doctor'],
  ['orderLab', 'Order lab test', 'doctor'], ['results', 'Review lab results', 'doctor'], ['refer', 'Refer to specialist', 'doctor'],
  ['admit', 'Admit patient', 'doctor'], ['discharge', 'Discharge patient', 'doctor'], ['operate', 'Perform surgery', 'surgeon'],
  ['schedule', 'Schedule operating room', 'surgeon'], ['consent', 'Obtain consent', 'surgeon'], ['medicate', 'Administer medication', 'nurse'],
  ['records', 'View medical record', 'patient'], ['portal', 'Use patient portal', 'outpatient'], ['teleconsult', 'Attend video consultation', 'outpatient'],
  ['ward', 'Assign ward bed', 'nurse'], ['handover', 'Hand over shift', 'nurse'], ['allergy', 'Check allergies', undefined],
  ['authenticate', 'Authenticate user', undefined], ['audit', 'Write audit trail', undefined],
];
for (const [id, name, by] of clinical) {
  uc(id, name, 'clinic', id === 'prescribe' ? { extensionPoints: ['controlled substance'] } : id === 'examine' ? { extensionPoints: ['abnormal findings'] } : {});
  if (by) rel('association', by, id);
}
const billing = [
  ['invoice', 'Create invoice'], ['claim', 'Submit insurance claim'], ['pay', 'Pay bill'], ['plan', 'Set up payment plan'],
  ['refund', 'Issue refund'], ['statement', 'Send statement'], ['copay', 'Collect co-payment'], ['verifyCover', 'Verify coverage'],
  ['dispute', 'Dispute charge'], ['writeoff', 'Write off debt'], ['tariff', 'Apply tariff'], ['reminder', 'Send payment reminder'],
  ['receipt', 'Issue receipt'], ['reconcile', 'Reconcile payments'],
];
for (const [id, name] of billing) uc(id, name, 'billing');
rel('association', 'patient', 'pay'); rel('association', 'patient', 'dispute'); rel('association', 'clerk', 'copay');
rel('association', 'clerk', 'invoice'); rel('association', 'clerk', 'reconcile');
rel('association', 'claim', 'insurer'); rel('association', 'verifyCover', 'insurer');
rel('association', 'pay', 'bank', { toEnd: { multiplicity: '1' } }); rel('association', 'refund', 'bank');
rel('association', 'orderLab', 'lab'); rel('association', 'results', 'lab');
for (const [base, inc] of [['prescribe', 'allergy'], ['medicate', 'allergy'], ['records', 'authenticate'], ['portal', 'authenticate'], ['diagnose', 'audit'],
  ['admit', 'ward'], ['operate', 'consent'], ['discharge', 'invoice'], ['invoice', 'tariff'], ['claim', 'verifyCover'], ['pay', 'receipt'], ['copay', 'receipt'], ['checkin', 'register']]) rel('include', base, inc);
rel('extend', 'refer', 'examine', { extensionPoint: 'abnormal findings', condition: 'specialist needed' });
rel('extend', 'orderLab', 'examine', { extensionPoint: 'abnormal findings' });
rel('extend', 'consent', 'prescribe', { extensionPoint: 'controlled substance' });
rel('extend', 'plan', 'pay', { extensionPoint: 'amount over limit', condition: 'balance > 500 EUR' });
rel('extend', 'reminder', 'statement', { extensionPoint: 'overdue' });
const pay = elements.find(e => e.id === 'pay'); pay.extensionPoints = ['amount over limit'];
const statement = elements.find(e => e.id === 'statement'); statement.extensionPoints = ['overdue'];
rel('association', 'clerk', 'statement'); rel('association', 'clerk', 'writeoff'); rel('association', 'clerk', 'refund');
rel('association', 'doctor', 'teleconsult'); rel('association', 'nurse', 'vitals'); rel('association', 'clerk', 'book');
elements.push({ id: 'n1', type: 'note', text: 'Every clinical action is written to the audit trail.', attachedTo: ['audit'] });
process.stdout.write(JSON.stringify({ kind: 'use-case', title: 'Hospital', elements, relationships }, null, 2) + '\n');
