export class ConsoleStore {
  messages = $state<string[]>([]);
  isVisible = $state(true);

  addMessage(message: string) {
    this.messages = [...this.messages, message];
  }

  clear() {
    this.messages = [];
  }

  toggle() {
    this.isVisible = !this.isVisible;
  }
}
