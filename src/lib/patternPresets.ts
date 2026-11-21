import type { InstrumentType } from '../types/song';

export interface PatternPresetOption {
  value: string;
  label: string;
  group?: string;
}

export interface PatternPresetGroup {
  category: string;
  options: readonly PatternPresetOption[];
}

export const PATTERN_PRESET_GROUPS: Record<
  InstrumentType,
  readonly PatternPresetGroup[]
> = {
  drums: [
    {
      category: '標準・基本',
      options: [
        { value: 'auto', label: 'おまかせ（標準）', group: '標準・基本' },
        { value: 'straight_8', label: '王道8ビート', group: '標準・基本' },
        { value: 'straight_16', label: 'タイト16ビート', group: '標準・基本' },
        { value: 'simple_minimal', label: 'シンプル骨格抜き', group: '標準・基本' },
      ],
    },
    {
      category: 'ロック・ヘヴィ',
      options: [
        { value: 'rock_drive', label: '疾走ロック・オープンHH', group: 'ロック・ヘヴィ' },
        { value: 'metal_double', label: 'ツーバス連打メタル', group: 'ロック・ヘヴィ' },
        { value: 'breakdown_heavy', label: 'ヘヴィ・ブレイク刻み', group: 'ロック・ヘヴィ' },
        { value: 'halftime_heavy', label: '重厚ハーフタイム', group: 'ロック・ヘヴィ' },
      ],
    },
    {
      category: 'Trap・ダンス',
      options: [
        { value: 'trap_sparse', label: '空間重視Trap（8分HH）', group: 'Trap・ダンス' },
        { value: 'trap_active', label: '激しめTrap（16/32分）', group: 'Trap・ダンス' },
        { value: 'four_on_floor', label: '4つ打ちダンスビート', group: 'Trap・ダンス' },
        { value: 'bounce_shuffle', label: '跳ねシャッフル', group: 'Trap・ダンス' },
        { value: 'disco_boogie_bounce', label: 'ディスコ・ブギー4つ打ち', group: 'Trap・ダンス' },
      ],
    },
    {
      category: '展開・特殊',
      options: [
        { value: 'build_up', label: 'クレッシェンド連打', group: '展開・特殊' },
        { value: 'rim_chill', label: 'チル・リムショット', group: '展開・特殊' },
        { value: 'jrock_anticipation', label: '小節またぎ食い（一斉）', group: '展開・特殊' },
      ],
    },
  ],
  bass: [
    {
      category: '基本・キック連動',
      options: [
        { value: 'auto', label: 'おまかせ（キック連動）', group: '基本・キック連動' },
        { value: 'root_steady', label: '堅実ルート8分刻み', group: '基本・キック連動' },
        { value: 'root_whole', label: '重厚ロング白玉ベース', group: '基本・キック連動' },
        { value: 'kick_lock', label: 'キック完全同期タイト', group: '基本・キック連動' },
      ],
    },
    {
      category: '動き・グルーヴ',
      options: [
        { value: 'octave_disco', label: 'オクターブ跳躍ドライブ', group: '動き・グルーヴ' },
        { value: 'melodic_walk', label: '5度・経過音ウォーク', group: '動き・グルーヴ' },
        { value: 'syncopated_groove', label: '16分シンコペーション', group: '動き・グルーヴ' },
        { value: 'slap_funk', label: 'ファンキー・スラップ', group: '動き・グルーヴ' },
        { value: 'disco_boogie_bounce', label: 'ディスコ・オクターブ跳ね', group: '動き・グルーヴ' },
      ],
    },
    {
      category: 'ヘヴィ・モダン',
      options: [
        { value: 'metal_gallop', label: '高速ギャロップ刻み', group: 'ヘヴィ・モダン' },
        { value: 'sub_808_glide', label: '808重低音サステイン', group: 'ヘヴィ・モダン' },
        { value: 'pedal_point', label: 'ペダル低音固定', group: 'ヘヴィ・モダン' },
        { value: 'jrock_anticipation', label: '小節またぎ食い（一斉）', group: 'ヘヴィ・モダン' },
      ],
    },
  ],
  keyboard: [
    {
      category: 'バッキング・刻み',
      options: [
        { value: 'auto', label: 'おまかせ（標準）', group: 'バッキング・刻み' },
        { value: 'chord_quarter', label: '王道4分コード刻み', group: 'バッキング・刻み' },
        { value: 'chord_eighth', label: '疾走8分リフ刻み', group: 'バッキング・刻み' },
        { value: 'syncopated_comp', label: '裏拍シンコペーション', group: 'バッキング・刻み' },
        { value: 'offbeat_ska', label: 'スカ風裏打ちカッティング', group: 'バッキング・刻み' },
      ],
    },
    {
      category: 'アルペジオ・分散',
      options: [
        { value: 'arp_up', label: '上昇アルペジオ（密度）', group: 'アルペジオ・分散' },
        { value: 'arp_down_up', label: '往復アルペジオ（密度）', group: 'アルペジオ・分散' },
        { value: 'arp_16th', label: '粒立ち分散（密度）', group: 'アルペジオ・分散' },
        { value: 'broken_chord', label: '王道ピアノ分散和音', group: 'アルペジオ・分散' },
        { value: 'emo_arp_cascade', label: 'エモ9th/M7アルペジオ', group: 'アルペジオ・分散' },
        { value: 'synth_pluck_arp', label: 'シンセプラック短め刻み', group: 'アルペジオ・分散' },
      ],
    },
    {
      category: 'ロック・ファンク',
      options: [
        { value: 'rock_power_riff', label: 'パワーコード8分刻み', group: 'ロック・ファンク' },
        { value: 'funk_16th_clav', label: '16分ファンキー刻み', group: 'ロック・ファンク' },
        { value: 'counter_melody', label: 'サビ裏高音カウンター', group: 'ロック・ファンク' },
        { value: 'gospel_rich_comp', label: 'おしゃれテンション和音', group: 'ロック・ファンク' },
        { value: 'disco_boogie_bounce', label: 'ディスコ・ブギー呼応', group: 'ロック・ファンク' },
      ],
    },
    {
      category: 'ロング・空間',
      options: [
        { value: 'whole_sustain', label: '白玉ロングコード支え', group: 'ロング・空間' },
        { value: 'floating_tension', label: '浮遊感M9/sus2空間', group: 'ロング・空間' },
        { value: 'dark_low_riff', label: 'ダーク低〜中域リフ', group: 'ロング・空間' },
        { value: 'jrock_anticipation', label: '小節またぎ食い（一斉）', group: 'ロング・空間' },
      ],
    },
    {
      category: 'フュージョン風',
      options: [
        { value: 'fusion_ep_comp', label: 'フュージョン9thシンコペ', group: 'フュージョン風' },
        { value: 'fusion_brass_stab', label: 'キメ重視シンセ・スタブ', group: 'フュージョン風' },
        { value: 'fusion_fast_arp', label: 'テンション駆け上がり分散', group: 'フュージョン風' },
      ],
    },
    {
      category: 'エレクトロニカ風',
      options: [
        { value: 'electronica_polyrhythm', label: '付点8分ポリリズム', group: 'エレクトロニカ風' },
        { value: 'electronica_glitch_arp', label: '不規則グリッチ分散', group: 'エレクトロニカ風' },
        { value: 'electronica_minimal_ostinato', label: 'ミニマル反復フレーズ', group: 'エレクトロニカ風' },
      ],
    },
  ],
  pad: [
    {
      category: '持続・広がり',
      options: [
        { value: 'auto', label: 'おまかせ（Tacet連動）', group: '持続・広がり' },
        { value: 'warm_whole', label: '王道ウォーム白玉パッド', group: '持続・広がり' },
        { value: 'analog_warm_drift', label: '中低域アナログ持続', group: '持続・広がり' },
        { value: 'high_shimmer', label: '高音キラキラ・シマー', group: '持続・広がり' },
        { value: 'dark_cinematic', label: '重厚ダークシネマ', group: '持続・広がり' },
        { value: 'strings_ensemble', label: '壮大ストリングス持続', group: '持続・広がり' },
        { value: 'choir_open_voicing', label: '透明クワイアオープン', group: '持続・広がり' },
      ],
    },
    {
      category: '色彩・動き',
      options: [
        { value: 'floating_9th', label: '浮遊感9th/M7ボイシング', group: '色彩・動き' },
        { value: 'fifth_drone', label: '5度＋8度緊張ドローン', group: '色彩・動き' },
        { value: 'swell_half', label: '2分音符コードスウェル', group: '色彩・動き' },
        { value: 'octave_layer', label: 'オクターブ重ね厚み持続', group: '色彩・動き' },
        { value: 'sidechain_pulse', label: 'サイドチェイン風パルス', group: '色彩・動き' },
        { value: 'shimmer_arp_pad', label: '白玉＋高音シマー分散', group: '色彩・動き' },
        { value: 'jrock_anticipation', label: '小節またぎ食い（一斉）', group: '色彩・動き' },
      ],
    },
  ],
  vocal: [
    {
      category: 'ラップ・リズム',
      options: [
        { value: 'rap_16th_push', label: 'ラップ：16分リズミック押し', group: 'ラップ・リズム' },
        { value: 'rap_triplet_trap', label: 'ラップ：3連トラップフロウ', group: 'ラップ・リズム' },
        { value: 'rap_nu_metal', label: 'ラップ：ミクスチャー刻み', group: 'ラップ・リズム' },
        { value: 'rap_monotone_chant', label: 'ラップ：モノトーンチャント', group: 'ラップ・リズム' },
        { value: 'rap_laidback_groove', label: 'ラップ：後ろノリタメ', group: 'ラップ・リズム' },
        { value: 'rap_double_time', label: 'ラップ：高速ダブルタイム', group: 'ラップ・リズム' },
        { value: 'rap_hook_chant', label: 'ラップ：2小節アンセムフック', group: 'ラップ・リズム' },
        { value: 'rap_jhiphop_bounce', label: 'ラップ：J-HipHopバウンス', group: 'ラップ・リズム' },
        { value: 'rap_mixture_melodic', label: 'ラップ：ミクスチャー歌ラップ', group: 'ラップ・リズム' },
        { value: 'rap_hybrid_soar', label: 'ラップ：ラップ×歌ハイブリッド', group: 'ラップ・リズム' },
        { value: 'rap_cinematic_burst', label: 'ラップ：シネマティック連打', group: 'ラップ・リズム' },
        { value: 'rap_emo_sparse', label: 'ラップ：エモラップ余白', group: 'ラップ・リズム' },
      ],
    },
    {
      category: 'メロディ・歌モノ',
      options: [
        { value: 'auto', label: 'おまかせ（Energy連動）', group: 'メロディ・歌モノ' },
        { value: 'melody_pop', label: '歌メロ：王道ポップ', group: 'メロディ・歌モノ' },
        { value: 'melody_soar_long', label: '歌メロ：伸びロングトーン', group: 'メロディ・歌モノ' },
        { value: 'melody_staccato_rock', label: '歌メロ：歯切れスタッカート', group: 'メロディ・歌モノ' },
        { value: 'melody_call_response', label: '歌メロ：コール＆レスポンス', group: 'メロディ・歌モノ' },
        { value: 'melody_syncopated_hook', label: '歌メロ：拍頭食いフック', group: 'メロディ・歌モノ' },
        { value: 'melody_ballad', label: '歌メロ：バラード長め持続', group: 'メロディ・歌モノ' },
        { value: 'melody_alt_minor', label: '歌メロ：オルタナペンタ', group: 'メロディ・歌モノ' },
        { value: 'melody_alt_soar', label: '歌メロ：オルタナ高音伸び', group: 'メロディ・歌モノ' },
        { value: 'melody_grunge_drag', label: '歌メロ：グランジうねり', group: 'メロディ・歌モノ' },
        { value: 'melody_britpop_catchy', label: '歌メロ：ブリットポップ跳躍', group: 'メロディ・歌モノ' },
        { value: 'melody_metalcore_chorus', label: '歌メロ：メタルコア疾走サビ', group: 'メロディ・歌モノ' },
        { value: 'melody_emo_screamo', label: '歌メロ：エモ切迫ハイトーン', group: 'メロディ・歌モノ' },
        { value: 'jrock_anticipation', label: '小節またぎ食い（一斉）', group: 'メロディ・歌モノ' },
      ],
    },
  ],
};
