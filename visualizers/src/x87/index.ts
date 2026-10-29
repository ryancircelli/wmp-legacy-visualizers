// The x87 transcendental instructions as this machine's FPU (Intel i7-11370H) computes them, fitted from its
// measured output: 64-bit results returned as [hi, lo] pairs (hi + lo exact). Shared by the ports.
export { fsin87, fcos87, sincos87 } from './trig';
export { fpatan87 } from './fpatan';
export { f2xm187 } from './f2xm1';
