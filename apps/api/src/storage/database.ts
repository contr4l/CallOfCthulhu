import { DatabaseSync } from "node:sqlite";
export function openDatabase(path: string) {
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  const version = Number(db.prepare("PRAGMA user_version").get()!.user_version);
  if (version > 3) throw new Error("数据库版本高于应用支持的版本");
  if (version === 0)
    db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
    CREATE TABLE character_templates(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),character TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE runs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),story_id TEXT NOT NULL,story_version TEXT NOT NULL,rules_version TEXT NOT NULL,engine_version TEXT NOT NULL,revision INTEGER NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE run_commands(run_id TEXT NOT NULL REFERENCES runs(id),command_id TEXT NOT NULL,request_hash TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(run_id,command_id));
    CREATE TABLE run_events(run_id TEXT NOT NULL REFERENCES runs(id),sequence INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(run_id,sequence));
    CREATE TABLE run_history(run_id TEXT NOT NULL REFERENCES runs(id),sequence INTEGER NOT NULL,frame TEXT NOT NULL,PRIMARY KEY(run_id,sequence));
    CREATE INDEX runs_owner ON runs(user_id,updated_at);
    PRAGMA user_version=1; COMMIT;`);
  if (version < 2)
    db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE dice_rolls(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),purpose TEXT NOT NULL,sides INTEGER NOT NULL,count INTEGER NOT NULL,payload TEXT NOT NULL,creation_hash TEXT,creation_response TEXT);
    PRAGMA user_version=2; COMMIT;`);
  if (version < 3)
    db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE shop_wallets(user_id TEXT PRIMARY KEY REFERENCES users(id),balance INTEGER NOT NULL CHECK(balance>=0));
    CREATE TABLE shop_inventory(user_id TEXT NOT NULL REFERENCES users(id),item_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>=0),PRIMARY KEY(user_id,item_id));
    CREATE TABLE achievement_claims(user_id TEXT NOT NULL REFERENCES users(id),achievement_id TEXT NOT NULL,points INTEGER NOT NULL,claimed_at TEXT NOT NULL,PRIMARY KEY(user_id,achievement_id));
    CREATE TABLE shop_purchases(user_id TEXT NOT NULL REFERENCES users(id),request_id TEXT NOT NULL,item_id TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(user_id,request_id));
    CREATE TABLE shop_check_windows(run_id TEXT PRIMARY KEY REFERENCES runs(id),revision INTEGER NOT NULL,before_revision INTEGER NOT NULL,before_state TEXT NOT NULL,action_id TEXT NOT NULL,input TEXT,target_bonus INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE shop_discarded_checks(run_id TEXT NOT NULL REFERENCES runs(id),sequence INTEGER NOT NULL,PRIMARY KEY(run_id,sequence));
    PRAGMA user_version=3; COMMIT;`);
  return db;
}
export function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = action();
    db.exec("COMMIT");
    return value;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
