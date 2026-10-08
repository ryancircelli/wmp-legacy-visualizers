// Alchemy.Battery — Windows Media Player's built-in "Battery" engine (wmp.dll, CBattery 0x18040b4b0).
// Spec: spec/battery/10-battery-engine.md. Same engine API as Alchemy.Engine plus setPreset(i)/preset/presetNames.
// 384x288 8-bit ping-pong buffers, four-stage chain (pre draws -> warp -> post draws -> blur) with two
// buffer swaps, a 256-entry palette cross-faded in three tables, and 26 presets (0 = Randomization).
// NO audio reduction: TimedLevel is handed to every draw class unchanged.
// Wrapped verbatim from src/75-battery.js (ARCHITECTURE.md "Engine"): same code, the IIFE opened into module scope.
import { A, type Surface, type TimedLevel } from '../ns';
import '../rand';
import './warps';
import './draws';
import './draws-a';
import { newArena, blurWasm, paletteWasm } from './kernel';
import type { BatteryShift } from './warps';
import type { BatteryDrawEffect, BatteryDrawCtx, BatteryDrawCtor } from './draws';

// ---------------------------------------------------------------- engine-side types
// warps.ts/draws.ts define the registry contract (BatteryShift/BatteryDrawEffect/BatteryDrawCtx);
// their engine-side expandos are optional there (a freshly-constructed instance has none yet), so
// here — where makeShift/makeDraw guarantee they're always populated before anything else touches
// them — EngineShift/EngineDraw narrow those fields to required via intersection.
type EngineShift = BatteryShift & {
  className: string;
  map: Int32Array | null;
  animMap: Int32Array[] | null;
  animIdx: number;
  animHold: number;
  mapComplete: boolean;
  building: boolean;
  buildRow: number;
  mw: number;
  mh: number;
  cx: number;
  cy: number;
  prev: EngineShift | null;
};

type EngineDraw = BatteryDrawEffect & { className: string };

interface WarpPoint { x: number; y: number; }

// Battery's own view of the draw ctx: dctx starts with buf/level null (nothing rendered yet) and
// is populated every frame before any draw() call, at which point it satisfies BatteryDrawCtx.
interface DrawCtx {
  buf: Uint8Array | null;
  w: number;
  h: number;
  level: TimedLevel | null;
  frame: number;
  pre: boolean;
  audio: Record<string, unknown>;
  sw?: number;
  sh?: number;
}

// [key, muiTitleId, displayName, currentShift, dbl[8], pre[[name,dbl[8]]], post[...], paletteLocked, palette]
type PresetData = [
  string, number, string, string, number[],
  [string, number[]][], [string, number[]][],
  number, string | null
];

export interface BatteryOptions {
  intended: boolean;
  fps: number;
  backgroundColor: number;
}

export interface BatteryConfig {
  width?: number;
  height?: number;
  resolution?: number;
  options?: Partial<BatteryOptions>;
  preset?: number;
}

var F32 = Math.fround;
var INV19 = 0.05263157894736842;        // .rdata literal — exactly 1/19, never computed
var RES_TABLE: number[][] = [[256, 192], [384, 288], [512, 384]];   // DAT_1808ec9f0, ctor index 1

// ---------------------------------------------------------------- registries (§7.1)
// Insertion order is load-bearing: RandomizeMovement/RandomizeEffects are rand() % count over these.
// CLinearShift really is constructed twice (two distinct singletons) => probability 2/15.
var SHIFT_NAMES = ['CLinearShift', 'CLinearShift', 'CThingusShift', 'CZoomShift', 'CRingSpinShift',
  'CStretchShift', 'CTileShift', 'CTrigShift', 'CSinShimmerShift', 'CEdgeFalloffShift',
  'CStarburstShift', 'CSwirlShift', 'CTrigStretchShift', 'CTwirlocity', 'CShiitake'];
var DRAW_NAMES = ['CEdgeTrace', 'CEdgeGradiant', 'CCosEdgeGradiant', 'CWaveEdge', 'CSpectrumEdge',
  'CCircleWaveform', 'CDotPlane', 'CJDar', 'CGalaxy', 'CJiggyScribble'];
// +0xe0 compat masks (§7.4): 1 = border/pre-only, 2 = overlay/pre-or-post.
var SHIFT_MASK: Record<string, number> = { CTileShift: 1 };
var DRAW_MASK: Record<string, number> = { CEdgeTrace: 1, CEdgeGradiant: 1, CCosEdgeGradiant: 1, CWaveEdge: 1, CSpectrumEdge: 1,
  CCircleWaveform: 2, CDotPlane: 2, CJDar: 2, CGalaxy: 2, CJiggyScribble: 2 };
// +0x1a0 = 0 in these five ctors: an out-of-range axis samples 0 instead of the destination coord.
var NO_IDENTITY: Record<string, number> = { CEdgeFalloffShift: 1, CRingSpinShift: 1, CStretchShift: 1, CTrigStretchShift: 1, CZoomShift: 1 };

// ---------------------------------------------------------------- blur tables (§3.2)
// decay[j] = min(max(1, j-1), 255); lut[s] = pin(decay[s/5]) == max(1, s/5 - 1) for s in [0,1280).
// Built once: CPreset::Activate rebuilds the identical decay variant, and the plain-average variant
// that exists between construction and the first Activate is never rendered.
var BLUR_LUT = (function () {
  var decay = new Uint8Array(256), j: number, s: number, v: number;
  for (j = 0; j < 256; j++) { v = j - 1; if (v < 1) v = 1; decay[j] = v < 255 ? v : 255; }
  var lut = new Uint8Array(0x500);
  for (s = 0; s < 0x500; s++) {
    v = decay[(s / 5) | 0] & 0xFF;
    lut[s] = v === 0 ? 1 : (v === 0xFF ? 0xFE : v);
  }
  return lut;
})();

// ---------------------------------------------------------------- shipped presets (§9)
// [key, muiTitleId, displayName, currentShift, dbl[8], pre[[name,dbl[8]]], post[...], paletteLocked,
//  palette] — palette is the key colours its gradient was built from (keyPalette), or 256 RGB triples
//  as hex where it is not one gradient (the flags byte is 0 in all 17 shipped blobs).
// Index order == the hive's case-insensitive key sort, which is what RegEnumKeyExW returns.
var PRESETS: PresetData[] = [
['BrightSphere',5700,'brightsphere','CRingSpinShift',[-0.037548448704905,0.762913906574249,0,0,0,0,0,0],[['CDotPlane',[37,0,0,384.000015258789,0,0,0,0]]],[],0,null],
['circledance',5721,'dance of the freaky circles','CTileShift',[0.0337656788527966,0,0,0,0,0,0,0],[['CEdgeTrace',[55,0,0,0,0,0,0,0]]],[['CCircleWaveform',[1,2,0.643847492279012,0,0,0,0,0]]],1,'07121907121A08121C09121E0A121F0B12210B13230C13240D13260E13280F132910132B10142D11142E12143013143214143315143515153716153817153A18153C19153D1A153F1A16411B16421C16441D16461E16471F16491F174B20174C21174E22175023175224175324185525185726185827185A28185C29185D29195F2A19612B19622C19642D19662E19672E1A692F1A6B301A6C311A6E321A70331A71331B73341B75351B76361B78371B7A381B7B381C7D391C7F3A1C803B1C823D1D863E1D863F1D86401D87411D87431D88441D88451D89461D89481D89491D8A4A1E8A4B1E8B4D1E8B4E1E8C4F1E8C501E8C511E8D531E8D541E8E551E8E561E8F581F8F591F8F5A1F905B1F905D1F915E1F915F1F92601F92611F92631F93641F936520946620946820956920956A20956B20966D20966E20976F209770219871219873229874229975229976229A78229A79229B7A229B7B229C7D229D7E229E7F229F80239F8123A08323A08423A08523A18623A18823A28923A28A23A38D24A48D25A58E27A68F28A78F2AA8902CA9912DAB922FAC9231AD9332AE9434AF9536B19537B29639B3973BB4983CB5983EB6993FB69A41B79B43B89B44B99C46BA9D48BC9D49BD9E4ABE9F4CBFA04DC0A04FC1A151C3A252C4A354C5A356C6A457C7A559C9A65ACAA65CCBA75ECCA85FCDA961CFA963D0AA64D1AB66D2AC68D3AC69D4AD6BD6AE6DD7AE6ED8AF70D9B072DAB173DCB175DDB276DEB378DFB47AE0B47BE1B57DE3B67FE4B780E5B782E6B884E7B985E9BA87EABA89EBBB8AECBD8EEFBD8FEFBE91EFBF92EFBF94EFC095EFC197EFC298EFC29AEFC39CEFC49DEFC59FEFC5A0EFC6A2EFC7A3EFC8A5EFC8A7EFC9A8EFCAAAEFCAABEFCBADEFCCAEEFCDB0EFCDB1EFCEB3EFCFB5EFD0B6EFD0B8EFD1B9EFD2BBEFD3BCEFD3BEEFD4C0EFD5C1EFD5C3EFD6C4EFD7C6EFD8C7EFD8C9EFD9CAEFDACCEFDBCEEFDBCFEFDCD1EFDDD2EFDED4EFDED5EFDFD7EFE0D9EFE0DAEFE1DCEFE2DDEFE3DFEFE3E0EFE4E2EFE5E3EFE6E5EFE6E7EFE7E8EFE8EAEFE9EBEFE9EDEFEAEEEFEBF0EF'],
['cominatya',5701,'cominatcha','CStretchShift',[0.0435239728506501,0.154408398550004,0,0,0,0,0,0],[['CJiggyScribble',[80,227,456,11,0,0,0,0]]],[],1,'1F041B E4F7E8'],
['cottonstar',5705,'cottonstar','CStarburstShift',[0.0282921845583943,0.14029969163239,32,0,0,0,0,0],[['CEdgeGradiant',[0,0,0,0,0,0,0,0]],['CDotPlane',[31,3,0,384.000015258789,0,0,0,0]]],[],0,null],
['dandelionaid',5702,'dandelionaid','CStarburstShift',[-0.0373287154336082,0.229520554002374,26,0,0,0,0,0],[['CJiggyScribble',[30,75,479,16,0,0,0,0]]],[['CJDar',[82,3,1,16,0.7027070033364,0,100,0]]],1,'0B150C 420438 27A288 6ABB91 F2F6F8'],
['DrowningFlower',5703,'drinkdeep','CShiitake',[7.52317880000919,0.00704214565301892,0.0218924530784406,2,0,0,0,0],[['CSpectrumEdge',[7,16,7,0,0,0,0,0]]],[['CJiggyScribble',[39,134,428,11,0,0,0,0]]],1,'090009 0262FA AFE0C3 E6EAEB EFFAE1'],
['EletriArnation',5704,'eletriarnation','CStarburstShift',[-0.0270867035103843,0.0415936765260994,22,1,0,0,0,0],[['CJiggyScribble',[101,222,666,19,0,0,0,0]]],[['CJDar',[9,0,0,8,1.10129399597645,1,100,0]]],1,'141F01 E5F1E7'],
['eventhorizon',5708,'event horizon','CShiitake',[7.69203772087771,0.130502610039042,0.000558488731732879,1,0,0,0,0],[['CSpectrumEdge',[159,59,0,0,0,0,0,0]]],[['CDotPlane',[24,2,0,384,0,0,0,0]]],0,null],
['Geeks Kick ASCII',5723,'hizodge','CShiitake',[0.943723866716027,0.0601674404976449,0.00662862035078735,3,0,0,0,0],[['CCosEdgeGradiant',[0.0097891174793886,0,0,0,0,0,0,0]]],[['CJDar',[76,3,0,8,1.40663168299943,0,100,0]]],1,'E7E3E9 278268 031915'],
['gemstone matrix',5706,'gemstonematrix','CTileShift',[0.100997955165803,0,0,0,0,0,0,0],[['CJDar',[68,3,0,32,0.727060773875564,0,100,0]]],[],1,'110600 2DEB44 36F054 1BE9E8 F3F0F8'],
['GrooveSwirl',5707,'sepiaswirl','CShiitake',[3.65889461524785,0.00247361957587322,0.017259743275266,1,0,0,0,0],[['CEdgeGradiant',[0,0,0,0,0,0,0,0]]],[['CCircleWaveform',[1,1,0.59098332811329,0,0,0,0,0]]],1,'E3EBFB C76C2E 1C081C'],
['illuminator',5709,'illuminator','CRingSpinShift',[0.0281029697969998,0.38616901114583,0,0,0,0,0,0],[['CEdgeTrace',[41,0,0,0,0,0,0,0]]],[['CCircleWaveform',[2,2,0.292255938366291,0,0,0,0,0]]],0,null],
['ISeeTheTruth',5710,'i see the truth','CShiitake',[0.943723866716027,0.0601674404976449,0.00662862035078735,3,0,0,0,0],[['CJiggyScribble',[70,200,1205,18,0,0,0,0]]],[],1,'161103 15FC07 4B44A2 C2CF4C F0E7F0'],
['kaleidoscope',5711,'kaleidovision','CRingSpinShift',[-0.0497924748777222,0.209820856153965,0,0,0,0,0,0],[['CDotPlane',[33,5,0,384.000015258789,0,0,0,0]]],[['CCircleWaveform',[1,2,0.453448607971712,0,0,0,0,0]]],0,null],
['khemicalnova',5724,'chemicalnova','CStarburstShift',[-0.0390469075411097,0.169341105222702,2,0,0,0,0,0],[['CEdgeGradiant',[0,0,0,0,0,0,0,0]]],[['CCircleWaveform',[1,1,0.437554567619842,0,0,0,0,0]],['CJDar',[84,0.761241512943963,0.616034439222392,14,0,0,100,0]]],1,'1A1D00 2707A5 488428 D87A15 EF0C9D 6C9BC3 5E90E1 D2E14E D4D487 FAE2E9'],
['Lotus',5713,'lotus','CStarburstShift',[0.0104510636694888,0.0136875514872372,30,0,0,0,0,0],[['CEdgeTrace',[55,0,0,0,0,0,0,0]]],[['CDotPlane',[30,6,0,384.000015258789,0,0,0,0]]],1,'16030F B8E0FC > 030211 AB2C97 E6E0ED / 69'],
['Nerds Are Cool',5712,'green is not your enemy','CShiitake',[5.93462934624404,0.106945695965418,0.0258461260362882,2,0,0,0,0],[['CWaveEdge',[1,0,0,0,0,0,0,0]]],[['CJiggyScribble',[37,166,736,19,0,0,0,0]]],1,'161103 15FC07 4B44A2 C2CF4C F0E7F0'],
['relativelycalm',5714,'relatively calm','CTwirlocity',[11,0.0227790163780411,8,0,0,0,0,0],[['CSpectrumEdge',[4,14,6,0,0,0,0,0]],['CJDar',[92,1,0,4,1.07506333782809,0,0,0]]],[['CDotPlane',[45,0,0,384,0,0,0,0]]],1,'070E11070F120810130811150913160A14180B161A0C181B0C181D0C1A1F0D1B200E1C220F1D24101E2510202711202912222B12232C13242F142530152632152834162935172A37172B39182D3A192E3C192F3E1A303F1B31411C32431D34441D35461E36481F374920384C20394E213A50213C52223D54233E55243F5724415925425A26435C26445E27455F2847612947632949642A4A662A4B682B4C6A2C4D6C2D4F6D2D506F2E51712F527230537431547631557832577933597B33597D345B7E355C80365D82375E83385F853961873962893A638B3B648C3B658E3C66903D67913E69933F6A953F6B963F6C98406E9A416F9C42709D43719F4372A14474A44575A54676A54676A64777A64877A64878A74979A74979A84A7AA94A7BA94B7BA94C7CAA4C7CAA4D7DAA4E7DAB4E7EAB4F7FAC4F80AD4F80AD5081AD5181AE5182AF5283AE5383AE5384AF5484AF5585B05586B05687B05787B15788B25888B25889B25989B3598AB35A8AB45A8BB45B8BB55C8CB55C8DB65D8DB65D8EB65F90B95F90B95F91B85F92B86092B96093B86094B86095B86195B86096B86197B86198B86198B86199B8629AB8629BB8629BB8629CB8639DB8639EB8639EB8639FB864A0B864A1B864A2B864A2B864A3B864A4B864A5B764A5B765A6B765A7B765A8B766A8B766A9B766AAB766ABB767ABB767ACB767ADB767AEB768AEB767B0B769B0B76AB1B86CB2B86DB3B96FB4BA71B4BA72B5BB74B6BC75B7BC77B8BD78B9BE7ABABE7BBABF7DBBC07FBCC180BDC182BEC283BEC285BFC386C0C488C0C48AC1C58BC2C68DC3C68EC4C790C4C891C5C893C6C994C7C996C8CA98C8CB9AC9CB9BCACC9DCBCD9ECCCDA0CDCEA1CECFA3CED0A4CFD0A6D0D1A7D1D2A9D2D2ABD3D3ACD3D4AED4D5AFD5D5B1D6D6B3D7D6B4D7D7B6D8D8B7D9D8B9DAD9BADBDABCDBDABEDCDBBFDCDCC1DDDDC2DEDDC4DFDEC5E0DFC7E1DFC8E2E0CBE3E0CCE3E1CEE4E2CFE5E2D1E6E3D2E7E4D4E7E4D5E8E5D7E9E6D8EAE6DAEBE7DBEBE7DDECE8DEEDE9E0EEE9E1EFE9E4EFEAE5F0EBE7F1ECE8F2EDEAF4EEEBF4EEEDF5EF'],
['sleepyspray',5715,'sleepyspray','CLinearShift',[-1,-3,0,0,0,0,0,0],[],[['CDotPlane',[45,0,0,384.000015258789,0,0,0,0]]],0,null],
['Smoke or Water',5716,'smoke or water?','CSwirlShift',[-0.0440031135492491,5,-5,0,0,0,0,0],[['CJDar',[88,3,1,32,0.727060773875564,0,100,0]]],[],1,'0D001E EBEEE1'],
['SpidersLastMoment',5718,'spider\'s last moment...','CShiitake',[5.93462934624404,0.106945695965418,0.0258461260362882,2,0,0,0,0],[],[['CJDar',[88,3,0,32,0.727060773875564,1,100,0]]],1,'161103 15FC07 4B44A2 C2CF4C F0E7F0'],
['strawberryaid',5719,'strawberryaid','CStretchShift',[-0.0370937228953403,0.142158268990143,0,0,0,0,0,0],[['CCosEdgeGradiant',[0.0806421126438045,0,0,0,0,0,0,0]]],[['CCircleWaveform',[1,1,0.584977285713585,0,0,0,0,0]],['CJDar',[94,1,0,8,1.19339885832127,0,0,0]]],1,'09120A0A120A0C120A0E120A10120A12120A13110B15110B17110B18110B1A110B1C110C1D100C1F100C21100C23100C25100D27100D280F0D2A0F0D2C0F0D2E0F0E300F0E310E0E330E0D350E0D370E0E390E0E3B0D0E3C0C0E3E0C0E400C0F420C0F440C0F460C0F470B0F490B104B0B104D0B104F0B10510B10520A11540A11560A11580A115A0A115B09125D09125F09126109126309126509136608136808136A08136C08136E08147008147107147307147507147707157907157B07157C06157E06158006168206168406168505168705168905178B05178D05178F05179004179204189404189604189804189A04189B03199D03199F03199F0319A3021AA3041CA4071EA50920A60C23A70E25A81127A9132AAA162CAB192EAC1B31AD1E33AE2035AF2338B0253AB1283CB22A3FB32D41B43043B53245B63548B7374AB73A4CB83C4FB93F51BA4153BB4456BC4758BD495ABE4C5DBF4E5FC05161C15364C25666C35868C45B6AC55E6DC6606FC76371C86574C96876CA6A78CB6D7BCC707DCC727FCD7582CE7782CF7A84D07C87D17F89D2818BD3828ED48590D58792D68A94D78C97D88F99D9919BDA949EDB96A0DC99A2DD9CA5DE9EA7DFA1A9E0A3ACE0A6AEE1A8B0E2ABB3E3ADB5E4B0B7E5B3B9E6B5BCE7B8BEE8BAC0E9BDC3EABFC5EBC2C7ECC4CAEDC7CCEECACEEFCCD1F0CFD3F1D1D5F2D4D8F3D6DAF5DCDFF5DCDFF5DCDFF5DCDFF5DDDFF5DDE0F4DDE0F4DEE0F4DEE0F4DEE1F4DFE1F3DFE1F3DFE1F3DFE2F3E0E2F3E0E2F3E0E2F2E1E3F2E1E3F2E1E3F2E2E3F2E2E4F1E2E4F1E2E4F1E3E4F1E3E5F1E3E5F0E4E5F0E4E5F0E4E6F0E5E6F0E5E6F0E5E6EFE5E7EFE6E7EFE6E7EFE6E7EFE7E8EEE7E8EEE7E8EEE8E8EEE8E9EEE8E9EDE9E9EDE9E9EDE9E9EDE9EAEDEAEAEDEAEAECEAEAECEBEBECEBEBECEBEBECECEBEBECECEBECECEAECECEAEDECEAEDEDEAEDEDE9EEEDE9EEEDE9EEEEE9EFEEE9EFEEE8EFEEE8EFEFE8F0EFE8F0EFE8F0EFE7F1F0E7F1F0E7F1F0E7F2F0E7F2F1E7F2F1E6F1F1E6F2F1E6F2F1E6F2F1E6F3F1E5F3F1E5F3F2E5F4F2E5F4F2E5F4F2'],
['the world',5720,'the world','CShiitake',[-0.348063600573748,0.130804621736227,0.0215704828190601,1,0,0,0,0],[['CSpectrumEdge',[214,106,0,0,0,0,0,0]],['CCircleWaveform',[0,2,0.522280057354732,0,0,0,0,0]],['CDotPlane',[46,1,0,384,0,0,0,0]]],[],1,'1C17121C17121D18131E19141F1A15201B16211B17221C18221D18231E19241F1A25201B26201C27211D28221E28231E29241F2A25202B25212C26212D27222E28232E29232F2924302A25312B26322C27332D28342E29352E29352F2A36302B37312C38322D39332E39332F3A342F3A35303B35313C36323D36333E37343F3835403935403A36413B37423B38433C39443D3A453E3B463F3B47403C47403D48413E49423F4A43404B44414C44414D45424D46434E47444F4845504946514947524A48534B48534C49544D4A554E4B564E4C574F4D58504E59514E5A524F5A52505B53515C54525D55535E56545F5754605755605856615957625A58635959645A5A655B5A665C5B665D5C675E5D685F5E69605F6A61606B62606C63616D64626D65636E65626F6663706764716864726965736A66736A67746B68756C69766D6A776E6A786F6B796F6C79706D7A716E7B726F7C73707D73707E72717F7372807473807574817675827676837776847877857978867A79867B7A877B7B887C7C897D7D8A7E7D8A7F7E8A7F7F8A80808B81818C82828D83838E84838F8484908585908686918787928888938989948989958A8A968B8B978C8C978D8D988D8E998E8F9A8F8F9B90909C91919D92929D92939E93949F9495A09595A19696A29797A39798A39899A4999AA59A9BA69B9BA79B9CA89C9DA99D9EAA9E9FAA9FA0ABA0A1ACA0A1ADA1A2AEA2A3AEA3A4AFA4A5AFA5A6B0A5A7B1A6A7B2A7A8B3A8A9B4A9AAB5AAABB5AAACB6AAADB7ABADB8ACAEB9ADAFBAADB0BBAEB1BCAFB2BCB0B3BDB1B4BEB2B4BFB2B5C0B3B7C1B4B9C2B5B9C2B6B9C3B7BAC4B7BAC5B8BBC6B9BCC7BABDC8BBBEC8BBBFC9BCC0CABDC0CBBEC1CCBFC2CDC0C3CEC0C4CFC1C5CFC2C6D0C3C6D1C4C6D2C5C7D3C5C8D4C6C9D5C7CAD5C8CBD6C9CBD7C9CCD8CACDD9CBCEDACCCFDACDD0DBCED1DBCED1DCCFD2DDD0D3DED1D4DFD2D5E0D3D6E1D3D7E1D4D7E2D5D8E3D6D9E4D7DAE5D7DBE6D8DCE7D9DDE7DADDE8DBDEE9DCDFEADCE0EBDDE1ECDEE2EDDFE3EDE0E3EEE1E4EFE1E5F0E2E6F1E3E7F2E4E8F3E5E9'],
['tornado',5722,'my tornado is resting','CSwirlShift',[0.0251609854424147,0,-10,0,0,0,0,0],[['CCircleWaveform',[3,1,0.489063709912248,0,0,0,0,0]]],[],0,null],
['what is an egab',5717,'back to the groove','CSwirlShift',[-0.0480376605583379,3,-4,0,0,0,0,0],[],[['CJDar',[75,3,0,9,1.40663168299943,0,100,0]],['CDotPlane',[38,0,0,384.000015258789,0,0,0,0]]],0,null],
];

var PRESET_NAMES = ['Randomization'].concat(PRESETS.map(function (p) { return p[2]; }));

function hexToPalette(hex: string): Uint8Array {                 // 256 RGB triples -> PALETTEENTRY{R,G,B,0} bytes
  var b = new Uint8Array(1024);
  for (var i = 0; i < 256; i++) {
    b[i * 4] = parseInt(hex.substr(i * 6, 2), 16);
    b[i * 4 + 1] = parseInt(hex.substr(i * 6 + 2, 2), 16);
    b[i * 4 + 2] = parseInt(hex.substr(i * 6 + 4, 2), 16);
  }
  return b;
}
// The stored palettes are ones Battery made itself: the saver (0x1804159a0) writes LIVE, as the authoring
// build left it. 'P' with the palette locked runs NewPalette and copies TO straight into LIVE: a gradient
// through NewPalette's key colours ('RRGGBB RRGGBB ...'). Locked ('p') after an auto-cycle fade finished,
// LIVE is that fade's last frame, FROM + (TO - FROM) * (len-1)/len, never quite TO ('FROM keys > TO keys
// / len'; any len from the lowest given gives the same bytes). All in that build's x87 arithmetic: t
// rounded to float, (b - a) * t exact, truncated (lerpInto rounds the product to float; here that differs).
function lerp87(a: number, b: number, t: number): number { return a + Math.trunc((b - a) * t); }
function keyPalette(spec: string): Uint8Array {
  var k = spec.split(' ').map(function (h) { return parseInt(h, 16); }), n = k.length, w = (256 / (n - 1)) | 0;
  var b = new Uint8Array(1024), start = 0, end = 0, i: number, c: number, t: number;
  for (var j = 0; j < n - 1; j++, start = end) {
    end = j === n - 2 ? 255 : start + w;
    for (i = start; i <= end; i++) {
      t = F32((i - start) / (end - start + 1));
      for (c = 0; c < 3; c++) b[i * 4 + c] = lerp87((k[j] >> (16 - 8 * c)) & 255, (k[j + 1] >> (16 - 8 * c)) & 255, t);
    }
  }
  return b;
}
function presetPalette(p: string): Uint8Array {
  if (p.length === 1536) return hexToPalette(p);
  var f = p.split(/ [>/] /), a = keyPalette(f[0]);
  if (f.length === 1) return a;
  var b = keyPalette(f[1]), t = F32((+f[2] - 1) / +f[2]);
  for (var i = 0; i < 1024; i++) a[i] = lerp87(a[i], b[i], t);
  return a;
}

// ---------------------------------------------------------------- primitives
// Line = 0x180414050: integer Bresenham straight into the byte buffer, NO clipping at all.
function line(buf: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, c: number): void {
  var pitch = w, p = pitch * y0 + x0, n = w * h;
  var dy = y1 - y0, sy = dy >= 0 ? pitch : -pitch, ay = dy >= 0 ? dy : -dy;
  var dx = x1 - x0, ax = dx >= 0 ? dx : -dx, sx = dx >= 0 ? 1 : -1, err = 0, i: number;
  if (ay < ax) {
    for (i = 0; i <= ax; i++) { if (p >= 0 && p < n) buf[p] = c; err += ay; p += sx; if (err > ax) { err -= ax; p += sy; } }
  } else {
    for (i = 0; i <= ay; i++) { if (p >= 0 && p < n) buf[p] = c; err += ax; p += sy; if (err > ay) { err -= ay; p += sx; } }
  }
}
// Blur = 0x180412250, four passes. Rows 1..h-2 use LINEAR neighbours (so x=0 reads the previous
// row's last pixel); only rows 0 and h-1 wrap, and row 0's x+1 at x=w-1 is the linear next byte.
function blur(src: Uint8Array, dst: Uint8Array, w: number, h: number): void {
  var lut = BLUR_LUT, p: number, x: number, base = (h - 1) * w, end = base;
  if (blurWasm(src, dst, w, h)) { /* rows 1..h-2 done in WebAssembly (kernel.ts) */ }
  else if (LE && (w & 3) === 0 && end > w && src.byteOffset % 4 === 0 && dst.byteOffset % 4 === 0) blurRows4(src, dst, w, end);
  else for (p = w; p < end; p++) dst[p] = lut[src[p - w] + src[p - 1] + src[p] + src[p + 1] + src[p + w]];
  dst[0] = lut[src[1] + src[w] + src[base] + src[w - 1] + src[0]];
  for (x = 1; x < w; x++) dst[x] = lut[src[x] + src[x + w] + src[x - 1] + src[x + 1] + src[x + base]];
  for (x = 0; x < w - 1; x++)
    dst[base + x] = lut[src[base - w + x] + src[base + x] + src[x] + src[base + x + 1] + src[base + x - 1]];
  p = h * w - 1;
  dst[p] = lut[src[p] + src[p - 1] + src[base] + src[w - 1] + src[p - w]];
}
// blur()'s rows 1..h-2, four pixels per 32-bit word (w % 4 == 0, little-endian): the even and odd
// bytes are summed in two 16-bit lanes each (5 * 255 fits), then looked up in the same LUT. The
// linear left/right neighbours come from the adjacent words, exactly as the byte loop reads them.
var LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
var M_EVEN = 0x00FF00FF;
function blurRows4(src: Uint8Array, dst: Uint8Array, w: number, end: number): void {
  var lut = BLUR_LUT;
  var s = new Uint32Array(src.buffer, src.byteOffset, src.length >> 2);
  var d = new Uint32Array(dst.buffer, dst.byteOffset, dst.length >> 2);
  var w4 = w >> 2, e4 = end >> 2, prev = s[w4 - 1], cur = s[w4];
  for (var j = w4; j < e4; j++) {
    var next = s[j + 1], up = s[j - w4], dn = s[j + w4];
    var L = (cur << 8) | (prev >>> 24), R = (cur >>> 8) | (next << 24);
    var se = (up & M_EVEN) + (L & M_EVEN) + (cur & M_EVEN) + (R & M_EVEN) + (dn & M_EVEN);
    var so = ((up >>> 8) & M_EVEN) + ((L >>> 8) & M_EVEN) + ((cur >>> 8) & M_EVEN) + ((R >>> 8) & M_EVEN) + ((dn >>> 8) & M_EVEN);
    d[j] = lut[se & 0xFFFF] | (lut[so & 0xFFFF] << 8) | (lut[se >>> 16] << 16) | (lut[so >>> 16] << 24);
    prev = cur; cur = next;
  }
}

// ---------------------------------------------------------------- the warp-map framework (§4)
// The 15 shift classes own warp()/randomize()/setParams(); everything below is engine-side state
// held ON the shift singleton (it survives preset switches, exactly as the DLL's do).
function recalc(s: EngineShift): void { s.buildRow = 0; s.mapComplete = false; }   // 0x180412160

function freeAnimMaps(s: EngineShift): void { s.animMap = null; s.animIdx = 18; }  // 0x180410df8

function allocMaps(s: EngineShift, w: number, h: number, animate: boolean | number): void {   // 0x180413480
  if (s.mw === w && s.mh === h && s.map) return;                // idempotent
  if (s.map) { s.map = null; freeAnimMaps(s); s.prev = null; }
  s.mw = s.mh = s.cx = s.cy = 0;
  if (!(w > 0 || h > 0)) return;                                // OR, not AND — (0,0,0) is the free path
  s.map = new Int32Array(w * h);
  if (!animate) s.animIdx = 18;
  else {
    s.animIdx = 0;
    s.animMap = [];
    for (var k = 0; k < 18; k++) s.animMap.push(new Int32Array(w * h));
  }
  s.mw = w; s.mh = h; s.cx = w >> 1; s.cy = h >> 1;
  if (s.setSize) s.setSize(w, h);
  recalc(s);
}

function storeMapPixel(s: EngineShift, x: number, y: number, sx: number, sy: number): void {   // 0x1804132f8
  var off = s.mw * y + x;
  var map = s.map!;
  map[off] = s.mw * sy + sx;
  if (!s.building && s.prev && s.prev.map && s.animIdx < 18 && s.animMap) {
    var prev = s.prev.map[off];
    var py = (prev / s.mw) | 0, px = prev % s.mw;               // unsigned division in the DLL
    for (var k = 1; k <= 18; k++) {                             // truncation toward zero, both casts
      s.animMap[k - 1][off] = Math.trunc(k * INV19 * (sx - px)) + px
                            + (Math.trunc(k * INV19 * (sy - py)) + py) * s.mw;
    }
  }
}

var WP: WarpPoint = { x: 0, y: 0 };                             // no allocation in the inner loop
function buildRows(s: EngineShift): void {                      // 0x180413630 — 3 scanlines per call
  if (s.mapComplete || !s.map) return;
  if (s.prev && (!s.prev.map || s.mw !== s.prev.mw || s.mh !== s.prev.mh)) { s.prev = null; freeAnimMaps(s); }
  var wrap = s.identityRecovery !== false;
  for (var pass = 0; pass < 3; pass++) {
    var y = s.buildRow;
    for (var x = 0; x < s.mw; x++) {
      WP.x = x; WP.y = y;
      s.warp(WP);
      var sx = WP.x | 0, sy = WP.y | 0;
      if (sx < 0 || sx >= s.mw) { sx = x; if (!wrap) sx = 0; }    // clampX is 0 for every class
      if (sy < 0 || sy >= s.mh) { if (!wrap) sy = 0; else sy = y; }
      storeMapPixel(s, x, y, sx, sy);
    }
    s.buildRow = ++y;
    if (y >= s.mh) { s.mapComplete = true; return; }
  }
}

function ensureMap(s: EngineShift, w: number, h: number): void {   // 0x180410e60
  if (w !== s.mw || h !== s.mh) allocMaps(s, w, h, false);      // reallocate with the morph OFF
  if (s.map && !s.mapComplete) {
    s.animIdx = 18; freeAnimMaps(s);                            // give up on the morph, finish NOW
    s.building = true;
    while (!s.mapComplete) buildRows(s);
    s.building = false;
  }
  if (s.prev) allocMaps(s.prev, 0, 0, 0);                       // release prev's map
}

function selectMap(s: EngineShift): Int32Array | null {         // 0x18041192c
  var idx = s.animIdx;
  if (idx >= 18 || !s.animMap) return s.map;
  var hold = s.animHold;                                        // read, THEN decrement
  s.animHold = hold - 1;
  if (hold < 1) {
    idx = ++s.animIdx;
    s.animHold = A.rand() % 15 + 1;
    if (idx > 17) { freeAnimMaps(s); return s.map; }
  }
  return s.animMap[idx];
}

// ---------------------------------------------------------------- class instantiation
function makeShift(name: string): EngineShift {
  var NS = A.BatteryWarps, Ctor = NS && (NS as unknown as Record<string, (new () => BatteryShift) | undefined>)[name];
  if (!Ctor && NS && NS.list) { var L = NS.list(); Ctor = L && L[SHIFT_NAMES.indexOf(name)]; }
  var s = (Ctor ? new Ctor() : { warp: function () {}, randomize: function () {}, setParams: function () {},
                               setSize: function () {}, placeholder: true }) as EngineShift;
  s.className = name;
  if ((s as { compatMask?: number }).compatMask === undefined) s.compatMask = SHIFT_MASK[name] || 0;
  if ((s as { identityRecovery?: boolean }).identityRecovery === undefined) s.identityRecovery = !NO_IDENTITY[name];
  // engine-side map state (base ctor 0x18040f308): animIdx 18 = "no morph", animHold 15
  s.map = null; s.animMap = null; s.animIdx = 18; s.animHold = 15;
  s.mapComplete = false; s.building = false; s.buildRow = 0;
  s.mw = 0; s.mh = 0; s.cx = 0; s.cy = 0; s.prev = null;
  return s;
}

function makeDraw(name: string): EngineDraw {
  var NS = A.BatteryDraws, Ctor = ((NS as unknown as Record<string, BatteryDrawCtor | null | undefined>)[name]);
  if (!Ctor && NS && NS.list) { var L = NS.list(); Ctor = L && L[DRAW_NAMES.indexOf(name)]; }
  var e = (Ctor ? new Ctor() : { draw: function () {}, randomize: function () {}, setParams: function () {},
                               setSize: function () {}, placeholder: true }) as EngineDraw;
  e.className = name;
  if ((e as { compatMask?: number }).compatMask === undefined) e.compatMask = DRAW_MASK[name] || 0;
  return e;
}

function setParams(e: EngineShift | EngineDraw, dbl: number[]): void {      // 0x180413230 + Recalc
  if (e.setParams) e.setParams(dbl);
  else for (var i = 0; i < 8; i++) (e as unknown as Record<string, unknown>)['dbl' + i] = dbl[i];
  if ((e as { map?: unknown }).map !== undefined) recalc(e as EngineShift);   // shifts invalidate their map
}
function reset(e: EngineShift | EngineDraw): void { e.randomize(); if ((e as { map?: unknown }).map !== undefined) recalc(e as EngineShift); }   // Reset = 0x1804133f0

// ---------------------------------------------------------------- CPreset (§7.3)
class Preset {
  declare eng: Battery;
  declare data: PresetData | null;
  declare shift: EngineShift | null;
  declare movementCurrent: EngineShift | null;
  declare movementNext: EngineShift | null;
  declare pre: EngineDraw[];
  declare post: EngineDraw[];
  declare w: number;
  declare h: number;
  declare autoEffects: boolean;
  declare autoMovement: boolean;
  declare effectsTimer: number;
  declare movementTimer: number;
  declare paused: boolean;
  declare naming: boolean;

  constructor(eng: Battery, data: PresetData | null) {
    this.eng = eng;
    this.data = data || null;                 // null == the synthesised Randomization preset
    this.shift = null;                        // CWarper+0x08
    this.movementCurrent = null; this.movementNext = null;
    this.pre = []; this.post = [];
    this.w = 0; this.h = 0;
    this.autoEffects = !data; this.autoMovement = !data;   // 1,1 for Randomization; 0,0 for saved
    this.effectsTimer = 0; this.movementTimer = 0;
    this.paused = false; this.naming = false;
  }

  setSize(w: number, h: number): void { this.w = w; this.h = h; this.naming = false; this.paused = false; }

  activate(): void {                       // 0x180414540 / 0x180414570
    this.w = this.h = 0;                                          // literal: nothing calls SetSize again
    this.effectsTimer = this.movementTimer = 0;                   // => both randomizers fire next frame
    if (this.data) this.loadPreset();
  }

  deactivate(): void {                     // 0x180414780 — gated on bAutoMovement
    if (!this.autoMovement) return;                               // no-op for every saved preset
    this.shift = null; this.movementCurrent = null; this.movementNext = null;
  }

  // LoadFromRegistry (0x1804149c0) against the embedded table instead of HKCU.
  loadPreset(): void {
    var eng = this.eng, d = this.data!, i: number, e: EngineDraw;
    this.pre.length = 0; this.post.length = 0;
    for (i = 0; i < d[5].length; i++) { e = eng.drawByName[d[5][i][0]]; if (e) { setParams(e, d[5][i][1]); this.pre.push(e); } }
    for (i = 0; i < d[6].length; i++) { e = eng.drawByName[d[6][i][0]]; if (e) { setParams(e, d[6][i][1]); this.post.push(e); } }
    var s = eng.shiftByName[d[3]];
    if (s) { setParams(s, d[4]); this.movementCurrent = s; this.shift = s; }
    else this.scheduleMovement();
    eng.palettePaused = d[7] !== 0;
    if (eng.palettePaused) { eng.TO.set(d[8] ? presetPalette(d[8]) : eng.LIVE); eng.paletteChangeRequested = true; }
  }

  // ---- the two down-counters (§8.2) ----
  scheduleMovement(): void {               // 0x180414ea0
    var m = (this.h / 3) | 0;
    this.movementTimer = A.rand() % 390 + (m > 60 ? m : 60);
    this.randomizeMovement();
  }
  scheduleEffects(): void {                // 0x180414e40
    this.effectsTimer = A.rand() % 310 + 90;
    this.randomizeEffects();
  }

  randomizeMovement(): void {              // 0x180415f40
    var eng = this.eng, reg = eng.shifts, n = reg.length;
    if (this.movementCurrent) allocMaps(this.movementCurrent, 0, 0, 0);   // free the outgoing map
    var B = this.movementNext;
    this.movementNext = null;
    this.movementCurrent = B;
    this.shift = B;
    if (n <= 0) return;
    var C: EngineShift;
    do { C = reg[A.rand() % n]; this.movementNext = C; } while (C === this.movementCurrent && n > 1);
    if (C) { allocMaps(C, eng.w, eng.h, eng.transitions); reset(C); }
    if (this.movementCurrent === null) this.randomizeMovement();   // cold start: recurse once
    else if (this.movementNext) this.movementNext.prev = this.movementCurrent;   // arm the 18-step morph
  }

  randomizeEffects(): void {               // 0x180415d60
    var reg = this.eng.draws, n = reg.length, e: EngineDraw;
    this.pre.length = 0; this.post.length = 0;
    var k = A.rand() % 2;                                         // 0 or 1 border effects, always PRE
    while (k > 0) {
      e = reg[A.rand() % n];
      if (e.compatMask & 1) { reset(e); this.pre.push(e); k--; }  // rejection sampling burns rand()
    }
    var m = (((A.rand() % 4 + 1) / 4) | 0) + 1;                   // 1, or 2 with probability 1/4
    while (m > 0) {
      e = reg[A.rand() % n];
      if (e.compatMask & 2) {
        reset(e);
        var toPre = (A.rand() & 1) !== 0;                         // +0xe4 is dead: always the coin flip
        (toPre ? this.pre : this.post).push(e);
        m--;
      }
    }
  }

  // ---- CPreset::Render, 0x1804155a0 ----
  render(L: TimedLevel): void {
    if (!this.paused && !this.naming) { this.movementTimer--; this.effectsTimer--; }
    if (this.autoMovement && this.movementTimer <= 0) this.scheduleMovement();
    if (this.autoEffects && this.effectsTimer <= 0) this.scheduleEffects();
    if (this.movementNext) buildRows(this.movementNext);          // 3 rows/frame, incl. the morph maps
    this.renderChain(L);
  }

  // ---- RenderChain, 0x1804145c0 — the pipeline, two swaps ----
  renderChain(L: TimedLevel): void {
    var eng = this.eng, i: number, e: EngineDraw;
    var mask = this.movementCurrent ? this.movementCurrent.compatMask : 0;
    var ctx = eng.dctx;
    ctx.level = L; ctx.frame = eng.frame;

    ctx.pre = true; ctx.buf = eng.front;
    for (i = 0; i < this.pre.length; i++) {
      e = this.pre[i];
      if ((mask & e.compatMask) === 0) e.draw(ctx as unknown as BatteryDrawCtx);   // CTileShift suppresses border draws
    }

    eng.applyWarp(this.shift);                                    // swap #1

    ctx.pre = false; ctx.buf = eng.front;
    for (i = 0; i < this.post.length; i++) this.post[i].draw(ctx as unknown as BatteryDrawCtx);  // no mask on the post pass

    eng.swap();                                                   // swap #2
    blur(eng.back, eng.front, eng.w, eng.h);
  }
}

// ---------------------------------------------------------------- the frame render() returns
// front shown through LIVE32, which the DLL expands into its 32-bit DIB every frame (§1). Here px is
// expanded when something reads it (the 2D presenter, a hash, a test): the WebGL2 presenter looks
// the colours up itself from idx and pal (engine/gl.ts), so on that path the pass never runs. front
// and LIVE32 change only in render() and resize(), so a late expansion is still the last frame.
class Frame implements Surface {
  declare eng: Battery;
  declare w: number;
  declare h: number;
  declare out: Uint32Array;
  declare stale: boolean;                // out is not this frame yet: the next read of px expands it

  constructor(eng: Battery, w: number, h: number, out: Uint32Array) {
    this.eng = eng; this.w = w; this.h = h; this.out = out; this.stale = false;
  }

  get px(): Uint32Array {
    if (this.stale) {
      this.stale = false;
      var px = this.out, pal = this.eng.LIVE32, src = this.eng.front, n = this.w * this.h;
      if (!paletteWasm(src, pal, px, n)) for (var i = 0; i < n; i++) px[i] = pal[src[i]];
    }
    return this.out;
  }

  // null once px has been read: whoever read it may have written it, and it is the frame from then on
  get idx(): Uint8Array | null { return this.stale ? this.eng.front : null; }
  get pal(): Uint32Array { return this.eng.LIVE32; }
}

// ---------------------------------------------------------------- CBattery
interface BatteryDebugInfo {
  engine: string; preset: number; presetName: string;
  size: string; frame: number; swaps: number;
  movement: string | null; movementNext: string | null;
  movementTimer: number; effectsTimer: number;
  auto: string;
  pre: string | null; post: string | null;
  morph: string | null;
  mapRows: string | null;
  palette: string;
  placeholders: string[];
}

class Battery {
  declare options: BatteryOptions;
  declare shifts: EngineShift[];
  declare draws: EngineDraw[];
  declare shiftByName: Record<string, EngineShift>;
  declare drawByName: Record<string, EngineDraw>;
  declare FROM: Uint8Array;
  declare LIVE: Uint8Array;
  declare TO: Uint8Array;
  declare LIVE32: Uint32Array;
  declare palettePaused: boolean;
  declare paletteAutoCycle: boolean;
  declare paletteChangeCountdown: number;
  declare paletteChangeRequested: boolean;
  declare paletteFading: boolean;
  declare paletteDirty: boolean;
  declare paletteFadeLen: number;
  declare paletteFadeCtr: number;
  declare transitions: boolean;
  declare idleDecay: number;
  declare presetChanged: boolean;
  declare frame: number;
  declare swaps: number;
  declare presets: Preset[];
  declare preset: number;
  declare dctx: DrawCtx;
  declare w: number;
  declare h: number;
  declare front: Uint8Array;
  declare back: Uint8Array;
  declare surface: Frame;
  declare last: Surface;
  declare allocPending: boolean;
  declare presetNames: string[];

  static PRESET_NAMES: string[] = PRESET_NAMES;
  static RESOLUTIONS: number[][] = RES_TABLE;
  static internals: {
    BLUR_LUT: Uint8Array; blur: typeof blur; line: typeof line;
    allocMaps: typeof allocMaps; buildRows: typeof buildRows; selectMap: typeof selectMap; ensureMap: typeof ensureMap;
    storeMapPixel: typeof storeMapPixel; recalc: typeof recalc; hexToPalette: typeof hexToPalette; presetPalette: typeof presetPalette;
    PRESETS: PresetData[]; SHIFT_NAMES: string[]; DRAW_NAMES: string[]; INV19: number;
  };

  constructor(cfg?: BatteryConfig) {
    cfg = cfg || {};
    this.options = Object.assign({ intended: false, fps: 60, backgroundColor: 0x000000 }, cfg.options);

    // the two singleton registries; a missing class becomes a no-op with the right compat mask
    var i: number;
    this.shifts = SHIFT_NAMES.map(makeShift);
    this.draws = DRAW_NAMES.map(makeDraw);
    this.shiftByName = {}; this.drawByName = {};
    for (i = 0; i < this.shifts.length; i++) this.shiftByName[SHIFT_NAMES[i]] = this.shifts[i];
    for (i = 0; i < this.draws.length; i++) this.drawByName[DRAW_NAMES[i]] = this.draws[i];

    // three palettes, PALETTEENTRY{R,G,B,flags} bytes, + the expanded 0x00RRGGBB view
    this.FROM = new Uint8Array(1024);
    this.LIVE = new Uint8Array(1024);
    this.TO = new Uint8Array(1024);
    for (i = 0; i < 256; i++) this.LIVE[i * 4 + 2] = i;          // the ctor's blue ramp (0x18040b4b0)
    this.LIVE32 = new Uint32Array(256);
    this.LIVE32[255] = 0x0000FF;                                 // never uploaded; keeps CreatePalette's value
    this.rebuildLive32();

    this.palettePaused = false;          // obj+0xd0 == PaletteLocked
    this.paletteAutoCycle = true;        // obj+0xd1
    this.paletteChangeCountdown = 0;     // obj+0xd4 — so a new palette fires on frame 1
    this.paletteChangeRequested = false;
    this.paletteFading = false;
    this.paletteDirty = false;
    this.paletteFadeLen = 0;
    this.paletteFadeCtr = 0;

    this.transitions = true;             // obj+0x62: the memory gate passes on anything modern
    this.idleDecay = 0;                  // obj+0xfec
    this.presetChanged = false;          // obj+0xfe8
    this.frame = 0;
    this.swaps = 0;

    this.presets = [new Preset(this, null)].concat(PRESETS.map(function (this: Battery, d: PresetData) { return new Preset(this, d); }, this));
    this.preset = 0;

    // the draw context (CONTRACT v3): TimedLevel passes through unchanged, audio stays empty
    // (the draw classes carry their own Line/LineClamped/Stroke primitives — see 72-battery-draws.js)
    this.dctx = { buf: null, w: 0, h: 0, level: null, frame: 0, pre: true, audio: {} };

    // CreateInstance order (0x18040ba20): operator new(0xff0) -> CBattery::CBattery 0x18040b4b0
    // (which builds BOTH registries at 0x18040f470, so every effect ctor's rand() runs on the CRT's
    // *default* seed) -> only THEN srand(time(NULL)) at 0x18040bd40 -> presets[0]->Activate().
    // Seeding before the registries would randomise CJDar's base colour, its anchor and every other
    // ctor roll per run; the real object's are fixed. Order is load-bearing, do not hoist.
    A.srand((Date.now() / 1000) | 0);          // 0x18040bd38 time(NULL) -> 0x18040bd40 srand
    // AllocAll (=> SetSize on every preset) is only reached on the first Render in the DLL, after
    // this Activate zeroed the preset's w/h — which is why Randomization's first movement period
    // really does see h = 288. resize() below stands in for it and must stay after the activate.
    this.presets[0].activate();                                  // Battery boots into Randomization
    var res = RES_TABLE[cfg.resolution === undefined ? 1 : cfg.resolution] || RES_TABLE[1];
    this.resize(cfg.width || res[0], cfg.height || res[1]);
    if (cfg.preset) this.setPreset(cfg.preset | 0);
  }

  seed(n: number): this { A.srand(n | 0); return this; }

  // AllocAll, 0x18040b8a4. Render never reallocates; only a resolution change (here: the host asking
  // for a different buffer size) gets this far, and it clears both buffers and re-SetSizes the presets.
  resize(w: number, h: number): void {
    this.w = Math.max(2, w | 0);
    this.h = Math.max(2, h | 0);
    // In the WebAssembly kernel's memory when there is one (kernel.ts), zeroed either way.
    if (this.surface) void this.surface.px;                     // the old frame keeps its last image
    var ar = newArena(this.w * this.h);
    this.front = ar ? ar.front : new Uint8Array(this.w * this.h);
    this.back = ar ? ar.back : new Uint8Array(this.w * this.h);
    this.surface = new Frame(this, this.w, this.h, ar ? ar.px : new Uint32Array(this.w * this.h));
    this.dctx.w = this.w; this.dctx.h = this.h;
    for (var i = 0; i < this.presets.length; i++) this.presets[i].setSize(this.w, this.h);
    for (i = 0; i < this.draws.length; i++) this.draws[i].setSize(this.w, this.h);
    this.last = this.surface;
    // AllocAll itself runs on the first Render after an allocation (Render gates it on
    // front->bits == NULL, 0x18040e298), i.e. AFTER SetCurrentPreset has run LoadFromRegistry.
    // Its SetSize sweep is what unlocks the palette — see the flag's use in render().
    this.allocPending = true;
  }

  swap(): void {
    var t = this.front; this.front = this.back; this.back = t;
    this.swaps++;
  }

  // CWarper::Apply, 0x180412460
  applyWarp(s: EngineShift | null): void {
    if (!s) return;
    ensureMap(s, this.w, this.h);
    if (!s.map) return;
    this.swap();
    var m = selectMap(s)!, dst = this.front, src = this.back, n = this.w * this.h;
    for (var i = 0; i < n; i++) dst[i] = src[m[i]];
  }

  // ---------------------------------------------------------------- palette (§5)
  rebuildLive32(): void {
    var L = this.LIVE, p = this.LIVE32;
    for (var i = 0; i < 255; i++) p[i] = (L[i * 4] << 16) | (L[i * 4 + 1] << 8) | L[i * 4 + 2];
  }

  gradient(start: number, end: number, key: Uint8Array, j: number): void {   // 0x180413138
    if (start > end) return;
    var span = F32(end - start + 1), TO = this.TO;
    for (var i = start; i <= end; i++) lerpInto(TO, i * 4, key, j * 3, key, (j + 1) * 3, F32(F32(i - start) / span));
  }

  buildPalette(fadeFrames: number, nKeys: number, key: Uint8Array): void {   // 0x180413838
    if (nKeys <= 1) return;
    var start = 0;
    for (var j = 0; j < nKeys - 1; j++) {
      var end = start + ((256 / (nKeys - 1)) | 0);
      if (j === nKeys - 2) end = 255;                            // last span forced to land on 255
      this.gradient(start, end, key, j);
      start = end;                                               // spans overlap by one entry
    }
    this.FROM.set(this.LIVE);
    this.paletteFadeLen = this.paletteFadeCtr = fadeFrames;
    this.paletteFading = true;
  }

  newPalette(): void {                   // 0x180412790
    var r1 = A.rand(), r2 = A.rand(), r3 = A.rand();
    var nKeys = r3 % ((r1 % 10 !== 0) ? 4 : 10) + 2;             // 2..5, or 2..11 one time in ten
    var key = new Uint8Array(11 * 3), lum = new Int32Array(11), i: number, g: number, b: number, r: number;
    g = A.rand() % 32; b = A.rand() % 32; r = A.rand() % 32;     // rand() order is g, b, r
    key[0] = r; key[1] = g; key[2] = b;                          // key 0 is guaranteed dark
    g = A.rand() % 32; b = A.rand() % 32; r = A.rand() % 32;
    key[3] = ~r & 0xFF; key[4] = ~g & 0xFF; key[5] = ~b & 0xFF;  // key 1 is guaranteed bright
    for (i = 2; i < nKeys; i++) {
      g = A.rand() % 256; b = A.rand() % 256; r = A.rand() % 256;
      key[i * 3] = r; key[i * 3 + 1] = g; key[i * 3 + 2] = b;
    }
    for (i = 0; i < nKeys; i++) lum[i] = key[i * 3] + key[i * 3 + 1] + key[i * 3 + 2];
    var desc = (r2 % 10 === 0), j: number, t: number;
    // Exchange sort, not bubble: every later key is compared against the pass's anchor key i and
    // swapped into it (strict compare, so equal sums keep the DLL's tie order; asm 0x180412960-9a8).
    for (i = 0; i < nKeys - 1; i++) {
      for (j = i + 1; j < nKeys; j++) {
        if (desc ? lum[i] < lum[j] : lum[j] < lum[i]) {
          t = lum[i]; lum[i] = lum[j]; lum[j] = t;
          for (var c = 0; c < 3; c++) { t = key[i * 3 + c]; key[i * 3 + c] = key[j * 3 + c]; key[j * 3 + c] = t; }
        }
      }
    }
    this.buildPalette(A.rand() % 250, nKeys, key);
  }

  updatePalette(): boolean {                // 0x180412510
    if (this.paletteChangeRequested) {
      this.paletteChangeRequested = false;
      this.paletteDirty = true;
      this.FROM.set(this.LIVE);
      this.paletteFading = true;
      this.paletteFadeLen = this.paletteFadeCtr = 25;             // a requested change always fades in 25
    }
    if (!this.palettePaused || this.paletteDirty) {
      if (this.paletteFading) {
        var t = this.paletteFadeLen > 0
          ? F32(F32(this.paletteFadeLen - this.paletteFadeCtr) / F32(this.paletteFadeLen)) : 1.0;
        for (var i = 0; i < 256; i++) lerpInto(this.LIVE, i * 4, this.FROM, i * 4, this.TO, i * 4, t);
        if (--this.paletteFadeCtr < 1) {
          this.paletteFading = this.paletteDirty = false;
          if (this.paletteAutoCycle) this.paletteChangeCountdown = A.rand() % 600;
        }
        return true;                                             // t never reaches 1: LIVE never equals TO
      }
      if (this.paletteAutoCycle && --this.paletteChangeCountdown < 1) this.newPalette();
    }
    return false;
  }

  // ---------------------------------------------------------------- presets (IWMPEffects +0x48)
  setPreset(n: number): boolean {
    n = n | 0;
    if (n < 0 || n >= this.presets.length) return false;         // E_INVALIDARG
    if (n === this.preset) return true;                          // a same-index call is a complete no-op
    this.presets[this.preset].deactivate();
    this.preset = n;
    this.presetChanged = true;                                   // next render() reports S_FALSE once
    this.presets[n].activate();                                  // note: the framebuffers are NOT cleared
    return true;
  }

  // ---------------------------------------------------------------- one Render (§1)
  render(L: TimedLevel): Surface | null {
    if (!L) return this.last;
    // AllocAll (0x18040b8a4), reached from Render BEFORE the state switch while front->bits is NULL.
    // Its SetSize sweep covers preset 0 (Randomization), whose SetSize is the RAW 0x1804160b0 —
    // the saved-preset override 0x180416100, which saves and restores engine+0xc8 around the call,
    // is NOT in Randomization's vtable (0x1807a7f70 +0x28 == 0x1804160b0). 0x1804160b0 calls
    // vt[0x88] = 0x180414710, which ends with `*(char*)(preset[2] + 200) = (char)preset[0xd1]`,
    // i.e. engine->bPalettePaused = that preset's own saved copy (0). So the first Render UNLOCKS
    // the palette of whatever locked preset was selected before it, and UpdatePalette's auto-cycle
    // then replaces the stored palette rand()%600 frames after the 25-frame registry fade ends.
    // Verified on the real object with the clock pinned and _o_rand hooked: preset 13 at seed
    // 1700000000 draws countdown 262 at frame 23 and calls NewPalette at frame 285; preset 20 draws
    // 151 and fires at 174 — the port now matches both frame for frame. A preset selected AFTER the
    // first Render keeps bPalettePaused = 1 and never drifts (confirmed against the real object by the private harness).
    if (this.allocPending) { this.allocPending = false; this.palettePaused = false; }
    switch (L.state) {
      case 0:                                                    // STOPPED
        if (this.idleDecay < 1) {
          this.surface.stale = false;                            // px itself is the frame here
          this.surface.px.fill(this.LIVE32[1]);                   // FillRect(LIVE[1]) and no blit
          return (this.last = this.surface);
        }
        this.swap();                                             // the stopped branch swaps ONCE
        blur(this.back, this.front, this.w, this.h);
        this.idleDecay--;
        var w = this.w, h = this.h, f = this.front;
        line(f, w, h, 0, 0, w - 1, 0, 1); line(f, w, h, 0, h - 1, w - 1, h - 1, 1);
        line(f, w, h, 0, 0, 0, h - 1, 1); line(f, w, h, w - 1, 0, w - 1, h - 1, 1);
        break;
      case 1: return this.last;                                  // PAUSED: the last frame is re-blitted
      case 2:                                                    // PLAYING
        this.idleDecay = 300;
        this.frame++;
        if (this.updatePalette()) this.rebuildLive32();
        this.presets[this.preset].render(L);
        break;
      default: return this.last;
    }
    this.presetChanged = false;               // the DLL returns S_FALSE once here; a port may ignore it
    this.surface.stale = true;                // the palette pass runs when px is read (Frame)
    return (this.last = this.surface);
  }

  debug(): BatteryDebugInfo {
    var p = this.presets[this.preset];
    var names = function (a: EngineDraw[]): string | null { return a.map(function (e) { return e.className; }).join('+') || null; };
    var cur = p.movementCurrent, nxt = p.movementNext;
    return {
      engine: 'Battery', preset: this.preset, presetName: PRESET_NAMES[this.preset],
      size: this.w + 'x' + this.h, frame: this.frame, swaps: this.swaps,
      movement: cur ? cur.className : null, movementNext: nxt ? nxt.className : null,
      movementTimer: p.movementTimer, effectsTimer: p.effectsTimer,
      auto: (p.autoMovement ? 'M' : '-') + (p.autoEffects ? 'E' : '-'),
      pre: names(p.pre), post: names(p.post),
      morph: cur ? (cur.animIdx >= 18 ? 'off' : cur.animIdx + '/18 hold ' + cur.animHold) : null,
      mapRows: nxt ? nxt.buildRow + '/' + nxt.mh : null,
      palette: (this.palettePaused ? 'locked' : 'cycling') +
        (this.paletteFading ? ' fade ' + (this.paletteFadeLen - this.paletteFadeCtr) + '/' + this.paletteFadeLen
                            : ' next in ' + this.paletteChangeCountdown),
      placeholders: (this.shifts as (EngineShift | EngineDraw)[]).concat(this.draws).filter(function (e) { return e.placeholder; })
        .map(function (e) { return e.className; }).filter(function (v, i, a) { return a.indexOf(v) === i; })
    };
  }
}

// LerpColour, 0x180411c58 — per channel, truncating, float32 t. peFlags is not touched.
function lerpInto(out: Uint8Array, o: number, a: Uint8Array, ao: number, b: Uint8Array, bo: number, t: number): void {
  for (var c = 0; c < 3; c++) out[o + c] = a[ao + c] + (F32(F32(b[bo + c] - a[ao + c]) * t) | 0);
}

Battery.prototype.presetNames = PRESET_NAMES;

// exported for tests
Battery.internals = { BLUR_LUT: BLUR_LUT, blur: blur, line: line,
  allocMaps: allocMaps, buildRows: buildRows, selectMap: selectMap, ensureMap: ensureMap,
  storeMapPixel: storeMapPixel, recalc: recalc, hexToPalette: hexToPalette, presetPalette: presetPalette,
  PRESETS: PRESETS, SHIFT_NAMES: SHIFT_NAMES, DRAW_NAMES: DRAW_NAMES, INV19: INV19 };

A.Battery = Battery;
export { Battery };
