/**
 * Q&A conversation state (web: stores/qaStore.ts + utils/qaExport.ts subset).
 * One conversation per dataset; turns record question/answer plus the model
 * that produced the answer ('' = local engine). Conversations persist through
 * project save (web: qa_conversations in the project manifest).
 */
export enum QaTurnRole {
  User = 0,
  Assistant = 1
}

@Observed
export class QaTurn {
  question: string;
  answer: string;
  model: string; // '' = local engine
  generatedAt: string;

  constructor(question: string, answer: string, model: string) {
    this.question = question;
    this.answer = answer;
    this.model = model;
    this.generatedAt = new Date().toISOString();
  }
}

@Observed
export class QaConversation {
  id: string;
  name: string;
  datasetKey: string;
  turns: QaTurn[] = [];

  constructor(id: string, name: string, datasetKey: string) {
    this.id = id;
    this.name = name;
    this.datasetKey = datasetKey;
  }
}

export class QaState {
  conversations: QaConversation[] = [];
  activeId: string = '';
  tick: number = 0;

  /** Return the conversation bound to a dataset, creating it on first use (web setDataset). */
  ensureForDataset(datasetKey: string, name: string): QaConversation {
    for (let i = 0; i < this.conversations.length; i++) {
      if (this.conversations[i].datasetKey === datasetKey) {
        this.activeId = this.conversations[i].id;
        return this.conversations[i];
      }
    }
    const conv = new QaConversation('qa_' + Date.now().toString(), name, datasetKey);
    this.conversations.push(conv);
    this.activeId = conv.id;
    this.bump();
    return conv;
  }

  current(): QaConversation | null {
    for (let i = 0; i < this.conversations.length; i++) {
      if (this.conversations[i].id === this.activeId) {
        return this.conversations[i];
      }
    }
    return null;
  }

  appendTurn(question: string, answer: string, model: string): void {
    const conv = this.current();
    if (conv === null) {
      return;
    }
    conv.turns.push(new QaTurn(question, answer, model));
    this.bump();
  }

  clearCurrent(): void {
    const conv = this.current();
    if (conv !== null) {
      conv.turns = [];
      this.bump();
    }
  }

  /** Serialize all conversations for project save (web qa_conversations). */
  exportList(): QaConvJson[] {
    const out: QaConvJson[] = [];
    for (let i = 0; i < this.conversations.length; i++) {
      const c = this.conversations[i];
      const turns: QaTurnJson[] = [];
      for (let k = 0; k < c.turns.length; k++) {
        const tt = c.turns[k];
        turns.push({ question: tt.question, answer: tt.answer, model: tt.model, generatedAt: tt.generatedAt });
      }
      out.push({ id: c.id, name: c.name, datasetKey: c.datasetKey, turns: turns });
    }
    return out;
  }

  /** Restore conversations from a saved project (web hydrate). */
  importList(list: QaConvJson[]): boolean {
    try {
      const convs: QaConversation[] = [];
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.id === undefined || c.datasetKey === undefined) {
          continue;
        }
        const conv = new QaConversation(c.id,
          c.name !== undefined && c.name.trim().length > 0 ? c.name : '新建问答', c.datasetKey);
        if (c.turns !== undefined) {
          for (let k = 0; k < c.turns.length; k++) {
            const tt = c.turns[k];
            const turn = new QaTurn(tt.question !== undefined ? tt.question : '',
              tt.answer !== undefined ? tt.answer : '', tt.model !== undefined ? tt.model : '');
            turn.generatedAt = tt.generatedAt !== undefined ? tt.generatedAt : turn.generatedAt;
            conv.turns.push(turn);
          }
        }
        convs.push(conv);
      }
      this.conversations = convs;
      this.activeId = convs.length > 0 ? convs[0].id : '';
      this.bump();
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Bump the tick and mirror it to AppStorage so @StorageLink watchers fire. */
  bump(): void {
    this.tick++;
    AppStorage.setOrCreate('qaTick', this.tick);
  }
}

/** Markdown export of one conversation (web: utils/qaExport.ts, markdown subset). */
export function conversationToMarkdown(conv: QaConversation): string {
  let md = '# ' + conv.name + '\n\n';
  md += '- ' + '数据集: ' + conv.datasetKey + '\n';
  md += '- ' + '导出时间: ' + new Date().toISOString() + '\n';
  md += '- ' + '轮数: ' + conv.turns.length + '\n\n';
  for (let i = 0; i < conv.turns.length; i++) {
    const turn = conv.turns[i];
    md += '## ' + (i + 1).toString() + '. ' + turn.question + '\n\n';
    md += turn.answer + '\n\n';
    md += '> ' + (turn.model.length > 0 ? turn.model : '本地引擎') + ' · ' + turn.generatedAt + '\n\n';
  }
  return md;
}

/** JSON shapes of the persisted conversation list (web qa_conversations). */
export interface QaTurnJson {
  question: string;
  answer: string;
  model: string;
  generatedAt: string;
}

export interface QaConvJson {
  id: string;
  name: string;
  datasetKey: string;
  turns?: QaTurnJson[];
}
