// Writes examples/composite-structure/stress.json (a robot controller: 24 parts,
// 3 with internal structure, 20 ports, 36 connectors, 2 collaborations):
//   node scripts/generate-composite-structure-stress.mjs > examples/composite-structure/stress.json
const joints = ['shoulder', 'elbow', 'wrist'];
const parts = [], relationships = [];
const connect = (from, to, extra = {}) => relationships.push({ type: 'connector', from, to, ...extra });

parts.push({ id: 'bus', name: 'bus', type: 'CanBus', ports: [{ id: 'busA', name: 'a' }, { id: 'busB', name: 'b' }] }, { id: 'planner', name: 'planner', type: 'MotionPlanner', ports: [{ id: 'plIn', name: 'goal', type: 'Pose' }, { id: 'plOut', name: 'cmd' }] }, { id: 'safety', name: 'safety', type: 'SafetyMonitor', multiplicity: '1' }, { id: 'log', name: 'log', type: 'EventLog', aggregation: 'shared' }, { id: 'clock', name: 'clock', type: 'Clock', aggregation: 'none' });
for (const [k, j] of joints.entries()) {
  parts.push({
    id: j, name: j, type: 'JointModule',
    ports: [{ id: `${j}Bus`, name: 'can' }],
    parts: [
      { id: `${j}Motor`, name: 'motor', type: 'ServoMotor' },
      { id: `${j}Enc`, name: 'encoder', type: 'Encoder', multiplicity: '1..2' },
      { id: `${j}Pid`, name: 'pid', type: 'PidLoop' },
    ],
  });
  connect(`${j}Bus`, `${j}Pid`);
  connect(`${j}Pid`, `${j}Motor`, { name: 'drive' });
  connect(`${j}Enc`, `${j}Pid`, { name: 'feedback', fromEnd: { multiplicity: '1..2' }, toEnd: { multiplicity: '1' } });
  connect(k % 2 ? 'busB' : 'busA', `${j}Bus`, { fromEnd: { multiplicity: '1' }, toEnd: { multiplicity: '1' } });
  parts.push({ id: `${j}Limit`, name: `${j}Limit`, type: 'LimitSwitch', multiplicity: '2' });
  connect(`${j}Limit`, 'safety', { toEnd: { role: 'monitor' } });
}
parts.push({ id: 'gripper', name: 'gripper', type: 'Gripper', ports: [{ id: 'grCtl', name: 'ctl' }] }, { id: 'camera', name: 'camera', type: 'StereoCamera', multiplicity: '0..1', ports: [{ id: 'camOut', name: 'frames', type: 'Image' }] }, { id: 'vision', name: 'vision', type: 'PoseEstimator', ports: [{ id: 'visIn', name: 'frames', type: 'Image', conjugated: true }] }, { id: 'teach', name: 'pendant', type: 'TeachPendant', aggregation: 'shared' });
connect('camOut', 'visIn', { name: 'stream', association: 'Video' });
connect('vision', 'plIn', { name: 'targets' });
connect('plOut', 'busA', { name: 'commands' });
connect('plOut', 'grCtl');
connect('safety', 'planner', { name: 'halt', fromEnd: { role: 'guard' }, toEnd: { role: 'subject' } });
connect('teach', 'planner', { fromEnd: { multiplicity: '0..1' } });
connect('clock', 'planner');
connect('clock', 'safety');
connect('safety', 'log');
connect('planner', 'log');
const robot = {
  id: 'robot', type: 'class', name: 'RobotArmController', stereotypes: ['subsystem'],
  ports: [
    { id: 'pCmd', name: 'command', type: 'TaskApi' },
    { id: 'pEstop', name: 'estop', type: 'Signal', multiplicity: '2' },
    { id: 'pCam', name: 'camera', type: 'Usb3' },
    { id: 'pPower', name: 'power', type: 'Power48V', conjugated: true },
  ],
  parts,
  collaborationUses: [
    { id: 'obs', name: 'faults', collaboration: 'observer', bindings: [{ role: 'oSubject', part: 'safety' }, { role: 'oObserver', part: 'log' }] },
    { id: 'loop', name: 'control', collaboration: 'feedback', bindings: [{ role: 'fPlant', part: 'shoulderMotor' }, { role: 'fSensor', part: 'shoulderEnc' }, { role: 'fController', part: 'shoulderPid' }] },
  ],
};
connect('pCmd', 'plIn', { name: 'tasks' });
connect('pEstop', 'safety', { toEnd: { multiplicity: '1' } });
connect('pCam', 'camOut');
connect('pPower', 'bus');
const elements = [
  robot,
  { id: 'observer', type: 'collaboration', name: 'Observer', roles: [{ id: 'oSubject', name: 'subject', type: 'Subject' }, { id: 'oObserver', name: 'observer', type: 'Observer', multiplicity: '*' }] },
  { id: 'feedback', type: 'collaboration', name: 'Feedback loop', roles: [{ id: 'fPlant', name: 'plant' }, { id: 'fSensor', name: 'sensor' }, { id: 'fController', name: 'controller' }] },
  { id: 'note', type: 'note', text: 'Every joint module repeats the same internal structure.', attachedTo: ['elbow'] },
];
relationships.push({ type: 'connector', from: 'oSubject', to: 'oObserver', name: 'notifies', toEnd: { multiplicity: '*' } }, { type: 'connector', from: 'fSensor', to: 'fController', name: 'measures' }, { type: 'connector', from: 'fController', to: 'fPlant', name: 'actuates' });
console.log(JSON.stringify({ kind: 'composite-structure', title: 'Robot arm controller', elements, relationships }, null, 1));
