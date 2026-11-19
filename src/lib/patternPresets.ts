import type { InstrumentType } from '../types/song';

export interface PatternPresetOption {
  value: string;
  label: string;
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
        { value: 'auto', label: 'おまかせ（スタイル連動）' },
        { value: 'straight_8', label: '王道8ビート' },
        { value: 'straight_16', label: 'タイト16ビート' },
        { value: 'simple_minimal', label: 'シンプル骨格・抜き' },
      ],
    },
    {
      category: 'ロック・ヘヴィ',
      options: [
        { value: 'rock_drive', label: '疾走ロック・オープンハット' },
        { value: 'metal_double', label: 'ツーバス連打メタル' },
        { value: 'breakdown_heavy', label: 'ヘヴィ・ブレイクダウン刻み' },
        { value: 'halftime_heavy', label: '重厚ハーフタイム（3拍目スネア）' },
      ],
    },
    {
      category: 'Trap・モダン',
      options: [
        { value: 'trap_sparse', label: '空間重視Trap（8分ハット＋控えめロール）' },
        { value: 'trap_active', label: 'アグレッシブTrap（16分＋32分ロール）' },
        { value: 'four_on_floor', label: '4つ打ちダンス／エレクトロ' },
        { value: 'bounce_shuffle', label: '跳ね系バウンス・シャッフル' },
        { value: 'disco_boogie_bounce', label: '【跳ねるディスコ】ブギー・オクターブ＆呼応ファンク' },
      ],
    },
    {
      category: '展開・特殊',
      options: [
        { value: 'build_up', label: '盛り上げクレッシェンド連打' },
        { value: 'rim_chill', label: 'チル・リムショット／控えめ' },
        { value: 'jrock_anticipation', label: '【小節またぎ食い】バンド一斉シンコペーション' },
      ],
    },
  ],
  bass: [
    {
      category: '基本・キック連動',
      options: [
        { value: 'auto', label: 'おまかせ（キック連動）' },
        { value: 'root_steady', label: '堅実ルート8分刻み' },
        { value: 'root_whole', label: '重厚ロングトーン・白玉' },
        { value: 'kick_lock', label: 'キック完全同期・タイト' },
      ],
    },
    {
      category: '動き・グルーヴ',
      options: [
        { value: 'octave_disco', label: 'オクターブ跳躍・ドライブ' },
        { value: 'melodic_walk', label: '5度・経過音アプローチ多め' },
        { value: 'syncopated_groove', label: '16分シンコペーション・うねり' },
        { value: 'slap_funk', label: 'ファンキー・スラップ風オクターブ' },
        { value: 'disco_boogie_bounce', label: '【跳ねるディスコ】ブギー・オクターブ＆呼応ファンク' },
      ],
    },
    {
      category: 'ヘヴィ・モダン',
      options: [
        { value: 'metal_gallop', label: '高速刻み・ギャロップ' },
        { value: 'sub_808_glide', label: '808連動・重低音サステイン' },
        { value: 'pedal_point', label: 'ペダルポイント・低音固定' },
        { value: 'jrock_anticipation', label: '【小節またぎ食い】バンド一斉シンコペーション' },
      ],
    },
  ],
  keyboard: [
    {
      category: 'バッキング・刻み',
      options: [
        { value: 'auto', label: 'おまかせ（スタイル連動）' },
        { value: 'chord_quarter', label: '【王道バッキング】4分コード刻み' },
        { value: 'chord_eighth', label: '【疾走バック】8分リフ刻み' },
        { value: 'syncopated_comp', label: '【ノリ重視】裏拍シンコペーション刻み' },
        { value: 'offbeat_ska', label: '【裏打ち】スカ／ダンス風カッティング' },
      ],
    },
    {
      category: 'アルペジオ・分散',
      options: [
        { value: 'arp_up', label: '【きれいめ分散】上昇アルペジオ（音数バー連動）' },
        { value: 'arp_down_up', label: '【繊細・叙情】往復アルペジオ（音数バー連動）' },
        { value: 'arp_16th', label: '【シーケンス】粒立ちアルペジオ（音数バー連動）' },
        { value: 'broken_chord', label: '【バラード伴奏】王道ピアノ分散和音' },
        { value: 'emo_arp_cascade', label: '【Aメロ・エモ】クリーン風9th/M7アルペジオ' },
        { value: 'synth_pluck_arp', label: '【エレクトロ】短めゲートのシンセプラック刻み' },
      ],
    },
    {
      category: 'ロック・ファンク・歌モノ拡張',
      options: [
        { value: 'rock_power_riff', label: '【ギター補強】低〜中域パワーコード8分刻み' },
        { value: 'funk_16th_clav', label: '【裏ノリ・歯切れ】16分ファンキー・カッティング' },
        { value: 'counter_melody', label: '【サビ裏メロ】高音オブリガート・カウンター' },
        { value: 'gospel_rich_comp', label: '【おしゃれ・厚】テンション・経過和音コンピング' },
        { value: 'disco_boogie_bounce', label: '【跳ねるディスコ】ブギー・オクターブ＆呼応ファンク' },
      ],
    },
    {
      category: 'ロング・空間',
      options: [
        { value: 'whole_sustain', label: '【シンプル支え】白玉ロングコード' },
        { value: 'floating_tension', label: '【空間・シューゲイズ】浮遊感M9/sus2コード' },
        { value: 'dark_low_riff', label: '【ダーク・不穏】低〜中音域リフ' },
        { value: 'jrock_anticipation', label: '【小節またぎ食い】バンド一斉シンコペーション' },
      ],
    },
    {
      category: 'フュージョン風',
      options: [
        { value: 'fusion_ep_comp', label: '【フュージョン】エレピ9th/13thシンコペーション刻み' },
        { value: 'fusion_brass_stab', label: '【フュージョン】キメ重視シンセ・スタブ' },
        { value: 'fusion_fast_arp', label: '【フュージョン】テンション駆け上がり分散和音' },
      ],
    },
    {
      category: 'エレクトロニカ風',
      options: [
        { value: 'electronica_polyrhythm', label: '【エレクトロニカ】付点8分ポリリズム・シーケンス' },
        { value: 'electronica_glitch_arp', label: '【エレクトロニカ】不規則休符＆クリスタル分散' },
        { value: 'electronica_minimal_ostinato', label: '【エレクトロニカ】ミニマル反復オスティナート' },
      ],
    },
  ],
  pad: [
    {
      category: '持続・広がり',
      options: [
        { value: 'auto', label: 'おまかせ（Auto Tacet連動）' },
        { value: 'warm_whole', label: '【サビ爆発】王道ウォーム白玉' },
        { value: 'analog_warm_drift', label: '【Aメロ・温かみ】中低域アナログ持続' },
        { value: 'high_shimmer', label: '【サビ高揚】高音域キラキラ・シマー広がり' },
        { value: 'dark_cinematic', label: '【イントロ・重厚】低〜中域ダークシネマティック' },
        { value: 'strings_ensemble', label: '【壮大・重厚】ストリングス風オクターブ＋5度持続' },
        { value: 'choir_open_voicing', label: '【透明感・神秘】クワイア風オープンボイシング' },
      ],
    },
    {
      category: '色彩・動き',
      options: [
        { value: 'floating_9th', label: '【浮遊・エモ】9th/M7空間ボイシング' },
        { value: 'fifth_drone', label: '【緊張・土台】5度＋オクターブのドローン持続' },
        { value: 'swell_half', label: '【うねり展開】2分音符ごとのコードスウェル' },
        { value: 'octave_layer', label: '【厚み重視】オクターブ重ね・分厚め持続' },
        { value: 'sidechain_pulse', label: '【エレクトロ・うねり】サイドチェイン風ボリュームパルス' },
        { value: 'shimmer_arp_pad', label: '【幻想・キラキラ】白玉＋高音ゆったり分散シマー' },
        { value: 'jrock_anticipation', label: '【小節またぎ食い】バンド一斉シンコペーション' },
      ],
    },
  ],
  vocal: [
    {
      category: 'ラップ・リズミック押し（抑揚控えめ）',
      options: [
        { value: 'rap_16th_push', label: '16分リズミック押し・狭音程連打' },
        { value: 'rap_triplet_trap', label: '3連トラップ・フロウ・休符混じり' },
        { value: 'rap_nu_metal', label: 'ミクスチャー／ニューメタル風・シンコペーション刻み' },
        { value: 'rap_monotone_chant', label: 'モノトーン・チャント・ルート中心' },
        { value: 'rap_laidback_groove', label: 'レイドバック・後ろノリ（裏拍タメ）' },
        { value: 'rap_double_time', label: '高速ダブルタイム（16分連打＆コントラスト）' },
        { value: 'rap_hook_chant', label: 'アンセム・掛け声フック（2小節モチーフ反復）' },
      ],
    },
    {
      category: 'メロディ・歌モノ',
      options: [
        { value: 'auto', label: 'おまかせ（Energy連動）' },
        { value: 'melody_pop', label: 'キャッチー8分メロディ' },
        { value: 'melody_soar_long', label: 'エモ・伸び重視（ロングトーン）' },
        { value: 'melody_staccato_rock', label: 'スタッカート・ロック（歯切れ重視）' },
        { value: 'melody_call_response', label: 'コール＆レスポンス（2小節歌＋余韻）' },
        { value: 'melody_syncopated_hook', label: 'シンコペーション・フック（拍頭食い）' },
        { value: 'melody_ballad', label: 'バラード・ロングトーン中心' },
        { value: 'melody_alt_minor', label: 'オルタナ・ダーク（マイナーペンタ主体）' },
        { value: 'jrock_anticipation', label: '【小節またぎ食い】バンド一斉シンコペーション' },
      ],
    },
  ],
};
