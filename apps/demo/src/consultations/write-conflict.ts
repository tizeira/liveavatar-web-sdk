export class ClaraRoutineConflictError extends Error {
  constructor() {
    super("Routine revision conflict");
    this.name = "ClaraRoutineConflictError";
  }
}
