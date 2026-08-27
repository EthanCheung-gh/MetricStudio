/**
 * Q&A conversation state (web: stores/qaStore.ts + utils/qaExport.ts subset).
 * One conversation per dataset; turns record question/answer plus the model
 * that produced the answer ('' = local engine). Sessions are in-memory for now
 * (web persists them through project save — planned for a later batch).
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
