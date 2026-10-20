import Event from './Event';

export default class DeviceOrientationEvent extends Event {

  constructor(type, options) {
    super(type, options);

    this.absolute = false;
    this.alpha = options.alpha;
    this.beta = options.beta;
    this.gamma = options.gamma;
  }
}
