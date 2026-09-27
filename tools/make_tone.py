# Regenerates the deterministic 90 s test tone used for all A/B work: python3 make_tone.py out.wav
import wave, struct, math, random, sys
random.seed(1); sr=44100; dur=90
f=wave.open(sys.argv[1],'wb'); f.setnchannels(2); f.setsampwidth(2); f.setframerate(sr); out=bytearray()
for i in range(sr*dur):
    t=i/sr; beat=(0.5+0.5*math.cos(2*math.pi*2.0*t))**6
    v=0.5*beat*math.sin(2*math.pi*55*t)+0.2*math.sin(2*math.pi*330*t)*(0.6+0.4*math.sin(2*math.pi*0.7*t))+0.12*math.sin(2*math.pi*1200*t)+0.06*math.sin(2*math.pi*4000*t)+0.05*(random.random()-0.5)
    s=int(max(-1,min(1,v))*32767); out+=struct.pack('<hh',s,int(s*0.9))
f.writeframes(bytes(out)); f.close(); print('wrote', sys.argv[1])
