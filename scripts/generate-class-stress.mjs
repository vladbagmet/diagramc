// Writes examples/class/stress.json (50 classes, 80 relationships, hospital domain):
//   node scripts/generate-class-stress.mjs > examples/class/stress.json
const names = [
  'Person',
  'Patient',
  'Doctor',
  'Nurse',
  'Staff',
  'Department',
  'Ward',
  'Room',
  'Bed',
  'Admission',
  'Discharge',
  'Appointment',
  'Schedule',
  'Shift',
  'Prescription',
  'Medication',
  'Dose',
  'Allergy',
  'Diagnosis',
  'Condition',
  'Procedure',
  'Surgery',
  'Anesthesia',
  'LabOrder',
  'LabResult',
  'Specimen',
  'Imaging',
  'Report',
  'Invoice',
  'InvoiceLine',
  'Payment',
  'Insurance',
  'Policy',
  'Claim',
  'Address',
  'Contact',
  'EmergencyContact',
  'MedicalRecord',
  'Note',
  'Vitals',
  'Observation',
  'Device',
  'Supplier',
  'Inventory',
  'StockItem',
  'PurchaseOrder',
  'AuditLog',
  'User',
  'Role',
  'Permission',
];
const ids = names.map(n => n[0].toLowerCase() + n.slice(1));
const types = ['String', 'Integer', 'Date', 'DateTime', 'Money', 'Boolean', 'UUID', 'Code'];
const elements = names.map((name, i) => {
  const e = { id: ids[i], type: 'class', name };
  if (name === 'Person' || name === 'Staff') e.abstract = true;
  const attrCount = ((i * 7) % 4) + 1,
    opCount = (i * 5) % 3;
  e.attributes = Array.from({ length: attrCount }, (_, k) => ({
    name: `${['id', 'name', 'code', 'status', 'createdAt', 'amount'][(i + k) % 6]}${k > 2 ? k : ''}`,
    type: types[(i + k) % types.length],
    visibility: k === 0 ? 'private' : 'protected',
  }));
  if (opCount)
    e.operations = Array.from({ length: opCount }, (_, k) => ({
      name: ['validate', 'total', 'close'][k],
      visibility: 'public',
      returnType: ['Boolean', 'Money', 'void'][k],
    }));
  return e;
});
elements[48].type = 'enumeration';
delete elements[48].attributes;
delete elements[48].operations;
elements[48].literals = ['ADMIN', 'CLINICIAN', 'BILLING', 'AUDITOR'];
const rel = [];
const gen = (a, b) => {
  rel.push({ type: 'generalization', from: a, to: b });
};
gen('patient', 'person');
gen('staff', 'person');
gen('doctor', 'staff');
gen('nurse', 'staff');
gen('surgery', 'procedure');
gen('labResult', 'report');
gen('imaging', 'procedure');
gen('emergencyContact', 'contact');
const kinds = ['association', 'composition', 'aggregation', 'association', 'dependency', 'association'];
let k = 0;
// Clustered like a real model: ten areas of five classes, dense inside an area,
// a few links between neighbouring areas.
const pairs = [];
for (let c = 0; c < 10; c++) {
  const m = [0, 1, 2, 3, 4].map(j => ids[c * 5 + j]);
  pairs.push(
    [m[0], m[1]],
    [m[0], m[2]],
    [m[1], m[3]],
    [m[2], m[4]],
    [m[3], m[4]],
    [m[1], m[2]],
    [m[4], ids[((c + 1) % 10) * 5 + (c % 3)]],
    [m[3], ids[((c + 3) % 10) * 5 + 1]],
  );
}
for (const [a, b] of pairs) {
  if (rel.length >= 80) break;
  if (a === b || rel.some(r => (r.from === a && r.to === b) || (r.from === b && r.to === a))) continue;
  const type = kinds[k++ % kinds.length];
  const r = { type, from: a, to: b };
  switch (type) {
    case 'composition': {
      r.fromEnd = { multiplicity: '1' };
      r.toEnd = { multiplicity: '0..*' };
      break;
    }
    case 'aggregation': {
      r.toEnd = { multiplicity: '*' };
      break;
    }
    case 'association': {
      r.toEnd = { multiplicity: k % 2 ? '0..1' : '1..*', ...(k % 5 ? {} : { role: b }), navigable: true };
      if (k % 4 === 0) r.name = 'has';
      break;
    }
    case 'dependency': {
      r.keyword = 'use';
      // No default
      break;
    }
  }
  rel.push(r);
}
console.log(JSON.stringify({ kind: 'class', title: 'Hospital (stress)', elements, relationships: rel }, null, 1));
