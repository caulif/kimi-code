import { LifecycleScope } from '#/app/scopes';

import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { unwrapErrorCause } from '#/_base/errors/errors';
import { IHostFileSystem } from '#/os/interface/hostFileSystem';

import { EditService } from './editService';
import { type FileEditInput, type FileEditResult, IFileEditService } from './fileEdit';
import { TextModel } from './textModel';

export class FileEditService implements IFileEditService {
  declare readonly _serviceBrand: undefined;

  private readonly editor: EditService;
  private readonly pendingEdits = new WeakMap<IHostFileSystem, Map<string, Promise<void>>>();

  constructor(@IHostFileSystem private readonly fs: IHostFileSystem) {
    this.editor = new EditService();
  }

  async edit(input: FileEditInput, fs: IHostFileSystem = this.fs): Promise<FileEditResult> {
    let pending = this.pendingEdits.get(fs);
    if (!pending) {
      pending = new Map();
      this.pendingEdits.set(fs, pending);
    }
    const previous = pending.get(input.path);
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    pending.set(input.path, promise);
    await previous;
    try {
      const raw = await fs.readText(input.path, { errors: 'strict' });
      const model = new TextModel(raw);
      const result = this.editor.apply(model, {
        path: input.displayPath,
        old_string: input.old_string,
        new_string: input.new_string,
        replace_all: input.replace_all,
      });
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      await fs.writeText(input.path, result.rawContent);
      return { ok: true, count: result.count };
    } catch (error) {
      const code = (unwrapErrorCause(error) as { code?: unknown } | null)?.code;
      if (code === 'EISDIR') {
        return { ok: false, error: `${input.displayPath} is not a file.` };
      }
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (pending.get(input.path) === promise) pending.delete(input.path);
      release();
    }
  }
}

registerScopedService(
  LifecycleScope.App,
  IFileEditService,
  FileEditService,
  ScopeActivation.OnScopeCreated,
  'edit',
);
