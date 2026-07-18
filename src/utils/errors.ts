export class EvalPilotError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'EvalPilotError';
  }
}

