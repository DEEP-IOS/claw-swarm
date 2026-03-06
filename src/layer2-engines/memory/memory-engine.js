/**
 * MemoryEngine — 记忆引擎门面 / Memory Engine Facade
 *
 * 提供 Layer 2 级别的记忆操作接口，封装底层 DB CRUD。
 * Provides Layer 2 level memory operation interface, wrapping lower-level DB CRUD.
 *
 * [WHY] 记忆引擎的 CRUD 实际实现在 db.js 中（与所有其他子系统共享一个 DB），
 * 但其他 Layer 需要一个清晰的 import 入口。这个门面文件提供该入口。
 * Memory engine CRUD is implemented in db.js (shared DB with all subsystems),
 * but other layers need a clean import entry point. This facade provides it.
 *
 * @module memory-engine
 * @author DEEP-IOS
 */

export {
  writeMemory,
  readMemories,
  readMemoriesByDateRange,
  saveCheckpoint,
  getLatestCheckpoint,
  getRecentCheckpoints,
  getDailySummary,
  upsertDailySummary,
  getEventCursor,
  updateEventCursor,
} from '../../layer1-core/db.js';
