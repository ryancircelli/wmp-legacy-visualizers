// jsdom has no canvas and logs "Not implemented" at every getContext: say none, as a browser without WebGL does
HTMLCanvasElement.prototype.getContext = () => null;
