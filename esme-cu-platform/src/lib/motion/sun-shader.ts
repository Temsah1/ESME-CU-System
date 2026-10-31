/**
 * The sun shader, kept out of the component so it can be read as maths.
 *
 * This is the source the brief specifies and it is deliberately unedited: the ten LOOK tables in
 * `SunTimeline.tsx` were tuned against these exact numbers, so a "tidy up" here changes what every
 * stage of the journey looks like on every machine at once.
 *
 * Two rules the maths has to hold: the ball never changes size (`rad` is a constant, and the limb
 * test is `d < rad + .02`), and the page is pure black because the halo falls off to exactly zero a
 * short way off the ball — a background gradient would show through where the light is meant to end.
 */

export const SUN_VERTEX = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';

export const SUN_FRAGMENT = `precision highp float;
uniform vec2 res;
uniform float sc, rad, cy, fade, t, evo, rot, blur, starX, freq, warp, cells, gas, shell, gI, flick;
uniform vec3 c0, c1, c2, glow;
float h(vec3 p){ p = fract(p*.3183099 + .1); p *= 17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.-2.*f);
  return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x), mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x), f.y),
             mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x), mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x), f.y), f.z); }
float fbm(vec3 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*n3(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=.5; } return s; }
vec3 stars(vec2 uv){
  vec2 q = (uv + vec2(starX, 0.))*34., id = floor(q), f = fract(q)-.5;
  float r = fract(sin(dot(id,vec2(127.1,311.7)))*43758.5453);
  vec2 o = vec2(fract(r*17.3),fract(r*91.7))-.5;
  float tw = .55+.45*sin(t*(.7+r*1.8)+r*40.);
  vec2 g = f-o*.7; g.x *= 1./(1.+blur*7.);
  return vec3(smoothstep(.975,1.,r)*smoothstep(.06,.0,length(g))*tw*.55);
}
void main(){
  vec2 uv = (gl_FragCoord.xy - .5*res)/res.y, p = (uv - vec2(0., cy))/sc;
  float d = length(p), e = max(d-rad, 0.);
  vec3 col = stars(uv);
  vec2 dir = p/max(d,1e-4);
  float rays = .72 + .56*fbm(vec3(dir*2.4, evo*.5));
  float hal = exp(-e/(rad*.11))*smoothstep(rad*.6, rad*.12, e);
  col += glow*gI*.7*hal*rays*flick;
  float py = (p.y + rad + .065)/.0135, px = p.x/(rad*1.02);
  float pool = max(0., 1.-px*px) * exp(-py*py);
  col += glow*min(gI,1.)*.1*pool*pool;
  if(d < rad + .02){
    float k = min(d/rad, 1.);
    vec3 nrm = vec3(p/rad, sqrt(max(1.-k*k, 0.)));
    float cr = cos(rot), sr = sin(rot);
    vec3 n = vec3(nrm.x*cr + nrm.z*sr, nrm.y, -nrm.x*sr + nrm.z*cr);
    float sq = 1./(1.+blur*3.2);
    vec3 q = vec3(n.x*sq, n.y, n.z*sq);
    float w1 = fbm(q*freq + vec3(0.,0.,evo*.28)), w2 = fbm(q*freq*.9 + 7. - vec3(evo*.22,0.,0.));
    float v = fbm(q*freq*1.7 + warp*2.2*vec3(w1, w2, w1-w2));
    float vein = 1.-abs(2.*fbm(q*freq*1.5 + warp*1.3*vec3(w2, w1, 0.))-1.);
    vein = pow(vein, 9.);
    float s = smoothstep(.24,.76,v);
    s = mix(s, clamp(vein*1.25 + s*.14,0.,1.), cells);
    vec3 c = mix(c0, c1, smoothstep(.0,.55,s));
    c = mix(c, c2, smoothstep(.5,1.,s));
    float mu = nrm.z;
    if(shell > .001){
      vec3 sh = c0 + c1*smoothstep(.95,.3,k)*(.25+v*1.2);
      float fil = smoothstep(.5,.82,k)*smoothstep(1.,.8,k)*pow(v+.32,3.)*3.2;
      sh += c2*fil + vec3(3.5,4.,5.)*exp(-k*k/.012);
      c = mix(c, sh, shell);
    } else {
      c *= mix(mix(.34, .8, gas), 1., pow(mu,.5));
    }
    c += glow*pow(1.-mu,2.6)*.42*min(gI,1.)*(1.-gas);
    float edge = smoothstep(1., .985, k);
    float soft = smoothstep(1., .58, k + (fbm(q*3.4 + evo*.1)-.5)*.62) * smoothstep(1., .9, k);
    float a = mix(edge, soft, gas);
    col = mix(col, c, a);
  }
  col = 1. - exp(-col*1.15);
  gl_FragColor = vec4(pow(col, vec3(.4545))*fade, 1.);
}`;
