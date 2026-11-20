const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-this-secret-before-deployment';
const DB_FILE = process.env.DB_FILE || './data/asset-movement.db';
fs.mkdirSync(path.dirname(path.resolve(DB_FILE)), { recursive: true });
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Data model follows the uploaded 24-step workflow. Asset and movement-item states
// are deliberately separate so partial returns and outstanding items remain visible.
db.exec(`
CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS branches (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), name TEXT NOT NULL, location TEXT DEFAULT '', UNIQUE(company_id,name));
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), branch_id INTEGER REFERENCES branches(id), name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL, department TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS assets (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), branch_id INTEGER REFERENCES branches(id), asset_tag TEXT NOT NULL UNIQUE, name TEXT NOT NULL, category TEXT DEFAULT '', serial_no TEXT DEFAULT '', condition TEXT DEFAULT 'Good', status TEXT NOT NULL DEFAULT 'AVAILABLE', custodian TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS movements (id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE, company_id INTEGER NOT NULL REFERENCES companies(id), branch_id INTEGER REFERENCES branches(id), requester_id INTEGER NOT NULL REFERENCES users(id), approver_id INTEGER REFERENCES users(id), purpose TEXT NOT NULL, destination TEXT NOT NULL, expected_return TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL', approval_note TEXT DEFAULT '', approved_at TEXT, issued_at TEXT, exit_at TEXT, closed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS movement_items (id INTEGER PRIMARY KEY, movement_id INTEGER NOT NULL REFERENCES movements(id), asset_id INTEGER NOT NULL REFERENCES assets(id), quantity INTEGER NOT NULL DEFAULT 1, accessories TEXT DEFAULT '', issue_condition TEXT DEFAULT '', issued_by INTEGER REFERENCES users(id), issued_at TEXT, exit_at TEXT, return_entry_at TEXT, received_by INTEGER REFERENCES users(id), received_at TEXT, return_condition TEXT DEFAULT '', item_status TEXT NOT NULL DEFAULT 'REQUESTED', discrepancy TEXT DEFAULT '', UNIQUE(movement_id,asset_id));
CREATE TABLE IF NOT EXISTS scans (id INTEGER PRIMARY KEY, movement_id INTEGER NOT NULL REFERENCES movements(id), movement_item_id INTEGER REFERENCES movement_items(id), scan_type TEXT NOT NULL, scanned_value TEXT NOT NULL, operator_id INTEGER NOT NULL REFERENCES users(id), location TEXT DEFAULT '', result TEXT NOT NULL, notes TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), user_id INTEGER REFERENCES users(id), movement_id INTEGER REFERENCES movements(id), action TEXT NOT NULL, details TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS discrepancy_cases (id INTEGER PRIMARY KEY, movement_id INTEGER NOT NULL REFERENCES movements(id), movement_item_id INTEGER REFERENCES movement_items(id), issue TEXT NOT NULL, resolution TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'OPEN', opened_by INTEGER REFERENCES users(id), resolved_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT);
`);

const count = db.prepare('SELECT COUNT(*) n FROM companies').get().n;
if (!count) {
  const companyId = db.prepare('INSERT INTO companies(name) VALUES (?)').run('Ben Holdings [PVT] LTD').lastInsertRowid;
  const branchId = db.prepare('INSERT INTO branches(company_id,name,location) VALUES (?,?,?)').run(companyId,'Colombo Head Office','Colombo, Sri Lanka').lastInsertRowid;
  const users = [
    ['System Administrator','admin@demo.local','Admin@123','SUPER_ADMIN','IT'],
    ['Department Manager','manager@demo.local','Manager@123','MANAGER','Operations'],
    ['Demo Employee','employee@demo.local','Employee@123','EMPLOYEE','Operations'],
    ['Stores Officer','stores@demo.local','Stores@123','STORES_IT','Stores'],
    ['Security Officer','security@demo.local','Security@123','SECURITY','Security'],
    ['Internal Auditor','auditor@demo.local','Auditor@123','AUDITOR','Audit']
  ];
  const addUser = db.prepare('INSERT INTO users(company_id,branch_id,name,email,password_hash,role,department) VALUES (?,?,?,?,?,?,?)');
  for (const u of users) addUser.run(companyId,branchId,u[0],u[1],bcrypt.hashSync(u[2],10),u[3],u[4]);
  const addAsset = db.prepare('INSERT INTO assets(company_id,branch_id,asset_tag,name,category,serial_no,condition,status) VALUES (?,?,?,?,?,?,?,?)');
  [
    ['AST-1001','Dell Latitude 5440','Laptop','DL5440-001','Good','AVAILABLE'],
    ['AST-1002','HP EliteBook 840','Laptop','HP840-002','Good','AVAILABLE'],
    ['AST-1003','Dell 24-inch Monitor','Monitor','DELL24-003','Good','AVAILABLE'],
    ['AST-1004','Logitech Conference Camera','Camera','LOGI-004','Good','AVAILABLE'],
    ['AST-1005','iPhone 15','Mobile','IPH15-005','Good','AVAILABLE'],
    ['AST-1006','Portable SSD 1TB','Storage','SSD-006','Good','AVAILABLE']
  ].forEach(a=>addAsset.run(companyId,branchId,...a));
}

const roles = {
  SUPER_ADMIN:['*'], COMPANY_ADMIN:['*'], MANAGER:['dashboard','requests','approvals','reports'],
  EMPLOYEE:['dashboard','requests'], STORES_IT:['dashboard','requests','issue','receive','assets','reports'],
  SECURITY:['dashboard','gate','reports'], AUDITOR:['dashboard','reports','audit']
};
function auth(req,res,next){
  const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  try { const payload=jwt.verify(token,JWT_SECRET); const user=db.prepare('SELECT id,company_id,branch_id,name,email,role,department FROM users WHERE id=? AND active=1').get(payload.id); if(!user) return res.status(401).json({error:'Account unavailable'}); req.user=user; next(); }
  catch { return res.status(401).json({error:'Please sign in again'}); }
}
function allow(...allowed){return (req,res,next)=>{if(!allowed.includes('*')&&!allowed.includes(req.user.role))return res.status(403).json({error:'You do not have permission for this action'});next();};}
function log(user,movementId,action,details=''){db.prepare('INSERT INTO audit_logs(company_id,user_id,movement_id,action,details) VALUES (?,?,?,?,?)').run(user.company_id,user.id,movementId,action,details);}
function ref(){return 'AM-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+Math.random().toString(36).slice(2,7).toUpperCase();}
function getMovement(id,companyId){return db.prepare(`SELECT m.*,u.name requester_name,ap.name approver_name FROM movements m JOIN users u ON u.id=m.requester_id LEFT JOIN users ap ON ap.id=m.approver_id WHERE m.id=? AND m.company_id=?`).get(id,companyId);}

app.post('/api/auth/login',(req,res)=>{
  const {email,password}=req.body||{}; const user=db.prepare('SELECT * FROM users WHERE lower(email)=lower(?) AND active=1').get(email||'');
  if(!user||!bcrypt.compareSync(password||'',user.password_hash))return res.status(401).json({error:'Invalid email or password'});
  const token=jwt.sign({id:user.id},JWT_SECRET,{expiresIn:'12h'});
  res.json({token,user:{id:user.id,name:user.name,email:user.email,role:user.role,department:user.department,company_id:user.company_id,branch_id:user.branch_id}});
});
app.get('/api/me',auth,(req,res)=>res.json(req.user));
app.get('/api/bootstrap',auth,(req,res)=>{
  const u=req.user; const movements=db.prepare(`SELECT m.*,u.name requester_name,(SELECT COUNT(*) FROM movement_items i WHERE i.movement_id=m.id) item_count,(SELECT COUNT(*) FROM movement_items i WHERE i.movement_id=m.id AND i.item_status NOT IN ('RECEIVED','RESOLVED')) outstanding FROM movements m JOIN users u ON u.id=m.requester_id WHERE m.company_id=? ORDER BY m.id DESC LIMIT 100`).all(u.company_id);
  const assets=db.prepare('SELECT * FROM assets WHERE company_id=? ORDER BY id DESC').all(u.company_id);
  const users=db.prepare('SELECT id,name,email,role,department FROM users WHERE company_id=? AND active=1 ORDER BY name').all(u.company_id);
  const audit=db.prepare('SELECT a.*,u.name user_name,m.reference FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN movements m ON m.id=a.movement_id WHERE a.company_id=? ORDER BY a.id DESC LIMIT 100').all(u.company_id);
  const cases=db.prepare(`SELECT d.*,m.reference,i.asset_id,a.asset_tag,a.name asset_name,u.name opened_by_name FROM discrepancy_cases d JOIN movements m ON m.id=d.movement_id LEFT JOIN movement_items i ON i.id=d.movement_item_id LEFT JOIN assets a ON a.id=i.asset_id LEFT JOIN users u ON u.id=d.opened_by WHERE m.company_id=? ORDER BY d.id DESC`).all(u.company_id);
  const stats={totalAssets:assets.length,available:assets.filter(a=>a.status==='AVAILABLE').length,outside:assets.filter(a=>a.status==='OUTSIDE').length,pending:movements.filter(m=>m.status==='PENDING_APPROVAL').length,overdue:movements.filter(m=>m.status!=='CLOSED'&&m.expected_return&&new Date(m.expected_return)<new Date()).length,openCases:cases.filter(c=>c.status==='OPEN').length};
  res.json({user:u,stats,movements,assets,users,audit,cases,roles:roles[u.role]||[]});
});
app.get('/api/assets',auth,(req,res)=>res.json(db.prepare('SELECT * FROM assets WHERE company_id=? ORDER BY asset_tag').all(req.user.company_id)));
app.post('/api/assets',auth,allow('SUPER_ADMIN','COMPANY_ADMIN','STORES_IT'),(req,res)=>{
  const {asset_tag,name,category,serial_no,branch_id}=req.body||{}; if(!asset_tag||!name)return res.status(400).json({error:'Asset tag and name are required'});
  try{const r=db.prepare('INSERT INTO assets(company_id,branch_id,asset_tag,name,category,serial_no) VALUES (?,?,?,?,?,?)').run(req.user.company_id,branch_id||req.user.branch_id,asset_tag.trim(),name.trim(),category||'',serial_no||'');log(req.user,null,'ASSET_CREATED',asset_tag);res.json({id:r.lastInsertRowid});}catch(e){res.status(400).json({error:'Asset tag already exists or asset could not be saved'});}
});
app.post('/api/movements',auth,allow('EMPLOYEE','MANAGER','SUPER_ADMIN','COMPANY_ADMIN'),(req,res)=>{
  const {purpose,destination,expected_return,items}=req.body||{};
  if(!purpose||!destination||!expected_return||!Array.isArray(items)||!items.length)return res.status(400).json({error:'Purpose, destination, return date and at least one asset are required'});
  const unique=[...new Set(items.map(x=>Number(x.asset_id)))]; if(unique.length!==items.length)return res.status(400).json({error:'Duplicate assets are not allowed in one request'});
  const tx=db.transaction(()=>{
    const r=db.prepare('INSERT INTO movements(reference,company_id,branch_id,requester_id,purpose,destination,expected_return) VALUES (?,?,?,?,?,?,?)').run(ref(),req.user.company_id,req.user.branch_id,req.user.id,purpose,destination,expected_return);
    const add=db.prepare('INSERT INTO movement_items(movement_id,asset_id,accessories,item_status) VALUES (?,?,?,?)');
    for(const item of items){const asset=db.prepare('SELECT * FROM assets WHERE id=? AND company_id=?').get(item.asset_id,req.user.company_id);if(!asset||asset.status!=='AVAILABLE')throw new Error(`Asset ${item.asset_id} is unavailable`);add.run(r.lastInsertRowid,asset.id,item.accessories||'','REQUESTED');}
    log(req.user,r.lastInsertRowid,'REQUEST_SUBMITTED',`Request ${r.lastInsertRowid} submitted with ${items.length} asset(s)`);return r.lastInsertRowid;
  });
  try{res.json({id:tx(),message:'Request submitted for approval'});}catch(e){res.status(400).json({error:e.message});}
});
app.get('/api/movements/:id',auth,(req,res)=>{
  const m=getMovement(Number(req.params.id),req.user.company_id);if(!m)return res.status(404).json({error:'Movement not found'});
  const items=db.prepare('SELECT i.*,a.asset_tag,a.name asset_name,a.serial_no,a.category FROM movement_items i JOIN assets a ON a.id=i.asset_id WHERE i.movement_id=?').all(m.id);
  const scans=db.prepare('SELECT s.*,u.name operator_name FROM scans s JOIN users u ON u.id=s.operator_id WHERE s.movement_id=? ORDER BY s.id').all(m.id);
  res.json({movement:m,items,scans});
});
app.post('/api/movements/:id/decision',auth,allow('MANAGER','SUPER_ADMIN','COMPANY_ADMIN'),(req,res)=>{
  const id=Number(req.params.id),{decision,note}=req.body||{},m=getMovement(id,req.user.company_id);if(!m)return res.status(404).json({error:'Movement not found'});if(m.status!=='PENDING_APPROVAL'&&m.status!=='CHANGES_REQUESTED')return res.status(400).json({error:'This request is not awaiting a decision'});
  if(!['APPROVE','REJECT','CHANGES'].includes(decision))return res.status(400).json({error:'Invalid decision'});
  const status={APPROVE:'APPROVED',REJECT:'REJECTED',CHANGES:'CHANGES_REQUESTED'}[decision];
  db.prepare('UPDATE movements SET status=?,approver_id=?,approval_note=?,approved_at=CASE WHEN ?="APPROVE" THEN CURRENT_TIMESTAMP ELSE approved_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,req.user.id,note||'',decision,id);log(req.user,id,'APPROVAL_'+decision,note||'');res.json({message:`Request ${status.toLowerCase().replace('_',' ')}`});
});
app.post('/api/movements/:id/issue',auth,allow('STORES_IT','SUPER_ADMIN','COMPANY_ADMIN'),(req,res)=>{
  const id=Number(req.params.id),m=getMovement(id,req.user.company_id);if(!m)return res.status(404).json({error:'Movement not found'});if(m.status!=='APPROVED')return res.status(400).json({error:'A valid approval is required before issue'});
  const {items}=req.body||{};if(!Array.isArray(items)||!items.length)return res.status(400).json({error:'Scan and confirm at least one asset'});
  const tx=db.transaction(()=>{
    for(const x of items){const item=db.prepare('SELECT i.*,a.status asset_status,a.asset_tag FROM movement_items i JOIN assets a ON a.id=i.asset_id WHERE i.id=? AND i.movement_id=?').get(x.item_id,id);if(!item||item.item_status!=='REQUESTED'||item.asset_status!=='AVAILABLE')throw new Error('Asset is not in the approved available issue list');
      db.prepare('UPDATE movement_items SET item_status="ISSUED",issue_condition=?,issued_by=?,issued_at=CURRENT_TIMESTAMP WHERE id=?').run(x.condition||'Good',req.user.id,item.id);
      db.prepare('UPDATE assets SET status="ALLOCATED" WHERE id=?').run(item.asset_id);
      db.prepare('INSERT INTO scans(movement_id,movement_item_id,scan_type,scanned_value,operator_id,location,result,notes) VALUES (?,?,?,?,?,?,?,?)').run(id,item.id,'COLLECTION',x.asset_tag||item.asset_tag,req.user.id,x.location||'Stores / IT','PASS','Issue confirmed');
    }
    const remaining=db.prepare('SELECT COUNT(*) n FROM movement_items WHERE movement_id=? AND item_status="REQUESTED"').get(id).n;
    db.prepare('UPDATE movements SET status=?,issued_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(remaining?'PARTIALLY_ISSUED':'ISSUED',id);log(req.user,id,'ASSET_ISSUED',`${items.length} asset(s) issued`);
  });try{tx();res.json({message:'Collection recorded. Movement pass is ready.'});}catch(e){res.status(400).json({error:e.message});}
});
app.post('/api/movements/:id/gate',auth,allow('SECURITY','SUPER_ADMIN','COMPANY_ADMIN'),(req,res)=>{
  const id=Number(req.params.id),m=getMovement(id,req.user.company_id);if(!m)return res.status(404).json({error:'Movement not found'});const {scan_type,pass,asset_tags,location}=req.body||{};
  if(!['EXIT','RETURN_ENTRY'].includes(scan_type))return res.status(400).json({error:'Invalid gate scan type'});
  if(pass!==m.reference)return res.status(400).json({error:'Movement pass does not match'});
  if(scan_type==='EXIT'&&!['ISSUED','PARTIALLY_ISSUED'].includes(m.status))return res.status(400).json({error:'Exit blocked: issue confirmation is required'});
  if(!Array.isArray(asset_tags)||!asset_tags.length)return res.status(400).json({error:'Scan each asset barcode'});
  const tx=db.transaction(()=>{
    for(const tag of asset_tags){const item=db.prepare(`SELECT i.*,a.asset_tag FROM movement_items i JOIN assets a ON a.id=i.asset_id WHERE i.movement_id=? AND a.asset_tag=?`).get(id,String(tag).trim());
      if(!item)throw new Error(`Unapproved or unknown asset ${tag}`);
      if(scan_type==='EXIT'){
        if(item.item_status!=='ISSUED')throw new Error(`${tag} has not been confirmed by Stores / IT or was already exited`);
        db.prepare('UPDATE movement_items SET item_status="OUTSIDE",exit_at=CURRENT_TIMESTAMP WHERE id=?').run(item.id);
      }else{
        if(!['OUTSIDE','ISSUED'].includes(item.item_status))throw new Error(`${tag} is not an outstanding item for this movement`);
        db.prepare('UPDATE movement_items SET item_status="ENTERED",return_entry_at=CURRENT_TIMESTAMP WHERE id=?').run(item.id);
      }
      db.prepare('INSERT INTO scans(movement_id,movement_item_id,scan_type,scanned_value,operator_id,location,result) VALUES (?,?,?,?,?,?,?)').run(id,item.id,scan_type,tag,req.user.id,location||'Security Gate','PASS');
    }
    const statuses=db.prepare('SELECT item_status FROM movement_items WHERE movement_id=?').all(id).map(x=>x.item_status);
    const next=scan_type==='EXIT'?'OUTSIDE':(statuses.every(s=>['RECEIVED','RESOLVED'].includes(s))?'CLOSED':'AWAITING_RECEIPT');
    db.prepare('UPDATE movements SET status=?,exit_at=CASE WHEN ?="EXIT" THEN CURRENT_TIMESTAMP ELSE exit_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(next,scan_type,id);log(req.user,id,scan_type==='EXIT'?'SECURITY_EXIT':'SECURITY_RETURN_ENTRY',`${asset_tags.length} asset(s) scanned at ${location||'Security Gate'}`);
  });try{tx();res.json({message:scan_type==='EXIT'?'Security exit recorded':'Return entry recorded'});}catch(e){res.status(400).json({error:e.message});}
});
app.post('/api/movements/:id/receive',auth,allow('STORES_IT','SUPER_ADMIN','COMPANY_ADMIN'),(req,res)=>{
  const id=Number(req.params.id),m=getMovement(id,req.user.company_id);if(!m)return res.status(404).json({error:'Movement not found'});const {items}=req.body||{};if(!Array.isArray(items)||!items.length)return res.status(400).json({error:'Select returned assets and record inspection'});
  const tx=db.transaction(()=>{
    for(const x of items){const item=db.prepare('SELECT i.*,a.asset_tag FROM movement_items i JOIN assets a ON a.id=i.asset_id WHERE i.id=? AND i.movement_id=?').get(x.item_id,id);if(!item||item.item_status!=='ENTERED')throw new Error('Only items recorded at the security return gate can be received');
      const condition=x.condition||'Good',issue=x.discrepancy||'';
      db.prepare('UPDATE movement_items SET item_status=?,received_by=?,received_at=CURRENT_TIMESTAMP,return_condition=?,discrepancy=? WHERE id=?').run(issue?'DISCREPANCY_OPEN':'RECEIVED',req.user.id,condition,issue,item.id);
      if(!issue)db.prepare('UPDATE assets SET status="AVAILABLE",condition=?,custodian="" WHERE id=?').run(condition,item.asset_id);
      else {db.prepare('UPDATE assets SET status="QUARANTINE",condition=? WHERE id=?').run(condition,item.asset_id);db.prepare('INSERT INTO discrepancy_cases(movement_id,movement_item_id,issue,opened_by) VALUES (?,?,?,?)').run(id,item.id,issue,req.user.id);}
      db.prepare('INSERT INTO scans(movement_id,movement_item_id,scan_type,scanned_value,operator_id,location,result,notes) VALUES (?,?,?,?,?,?,?,?)').run(id,item.id,'RECEIPT',item.asset_tag,req.user.id,'Stores / IT',issue?'DISCREPANCY':'PASS',issue||`Condition: ${condition}`);
    }
    const pending=db.prepare('SELECT COUNT(*) n FROM movement_items WHERE movement_id=? AND item_status NOT IN ("RECEIVED","RESOLVED")').get(id).n;
    db.prepare('UPDATE movements SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(pending?'PARTIAL_RETURN':'RECEIVED_PENDING_CLOSE',id);log(req.user,id,'RETURN_INSPECTED',`${items.length} item(s) inspected`);
  });try{tx();res.json({message:'Physical receipt and inspection recorded'});}catch(e){res.status(400).json({error:e.message});}
});
app.post('/api/cases/:id/resolve',auth,allow('STORES_IT','SUPER_ADMIN','COMPANY_ADMIN','MANAGER'),(req,res)=>{
  const id=Number(req.params.id),{resolution}=req.body||{};const c=db.prepare('SELECT d.*,m.company_id FROM discrepancy_cases d JOIN movements m ON m.id=d.movement_id WHERE d.id=?').get(id);if(!c||c.company_id!==req.user.company_id)return res.status(404).json({error:'Case not found'});if(c.status!=='OPEN')return res.status(400).json({error:'Case is already resolved'});if(!resolution)return res.status(400).json({error:'Resolution details are required'});
  const tx=db.transaction(()=>{db.prepare('UPDATE discrepancy_cases SET status="RESOLVED",resolution=?,resolved_by=?,resolved_at=CURRENT_TIMESTAMP WHERE id=?').run(resolution,req.user.id,id);if(c.movement_item_id){db.prepare('UPDATE movement_items SET item_status="RESOLVED",discrepancy=? WHERE id=?').run(resolution,c.movement_item_id);db.prepare('UPDATE assets SET status="AVAILABLE",custodian="" WHERE id=(SELECT asset_id FROM movement_items WHERE id=?)').run(c.movement_item_id);}log(req.user,c.movement_id,'DISCREPANCY_RESOLVED',resolution);});tx();res.json({message:'Discrepancy resolved'});
});
app.post('/api/movements/:id/close',auth,allow('STORES_IT','SUPER_ADMIN','COMPANY_ADMIN','MANAGER'),(req,res)=>{
  const id=Number(req.params.id),m=getMovement(id,req.user.company_id);if(!m)return res.status(404).json({error:'Movement not found'});const pending=db.prepare('SELECT COUNT(*) n FROM movement_items WHERE movement_id=? AND item_status NOT IN ("RECEIVED","RESOLVED")').get(id).n;const cases=db.prepare('SELECT COUNT(*) n FROM discrepancy_cases WHERE movement_id=? AND status="OPEN"').get(id).n;if(pending||cases)return res.status(400).json({error:`Cannot close: ${pending} asset(s) outstanding and ${cases} unresolved case(s)`});db.prepare('UPDATE movements SET status="CLOSED",closed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);log(req.user,id,'MOVEMENT_CLOSED','All items received or resolved; no open discrepancy cases');res.json({message:'Movement closed'});
});
app.get('/api/reports/summary',auth,(req,res)=>{const cid=req.user.company_id;res.json({byStatus:db.prepare('SELECT status,COUNT(*) count FROM movements WHERE company_id=? GROUP BY status').all(cid),assets:db.prepare('SELECT status,COUNT(*) count FROM assets WHERE company_id=? GROUP BY status').all(cid),openCases:db.prepare('SELECT COUNT(*) count FROM discrepancy_cases d JOIN movements m ON m.id=d.movement_id WHERE m.company_id=? AND d.status="OPEN"').get(cid).count});});
app.get('/api/health',(req,res)=>res.json({ok:true,service:'Asset Movement System'}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Asset Movement System running at http://localhost:${PORT}`));
