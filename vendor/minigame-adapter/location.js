class Location {
  constructor() {
    this.href = '';
    this.host = '';
    this.search = '';
    this.origin = '';
    this.pathname = '';
    this.hostname = '';
    this.reload = function () {};
  }

  toString() {
    return this.href;
  }
}

export default new Location();
