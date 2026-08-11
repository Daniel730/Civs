/**
 * Generate a minimal OBS scene collection for CivsNightshift.
 * Interstitial color+text scenes + shared placeholders for capture/music/overlay.
 * Window/Game capture target must be bound once in OBS UI.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function uuid() {
  return crypto.randomUUID();
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--overlay') out.overlay = argv[++i];
    else if (argv[i] === '--music') out.music = argv[++i];
  }
  return out;
}

function sourceBase(name, id, settings, extra = {}) {
  return {
    prev_ver: 536936448,
    name,
    uuid: uuid(),
    id,
    versioned_id: id,
    settings: settings || {},
    mixers: 255,
    sync: 0,
    flags: 0,
    volume: 1.0,
    balance: 0.5,
    enabled: true,
    muted: false,
    'push-to-mute': false,
    'push-to-mute-delay': 0,
    'push-to-talk': false,
    'push-to-talk-delay': 0,
    hotkeys: {},
    deinterlace_mode: 0,
    deinterlace_field_order: 0,
    monitoring_type: 0,
    private_settings: {},
    ...extra,
  };
}

function sceneItem(source, id) {
  return {
    name: source.name,
    source_uuid: source.uuid,
    visible: true,
    locked: false,
    rot: 0.0,
    scale_ref: { x: 1920.0, y: 1080.0 },
    align: 5,
    bounds_type: 0,
    bounds_align: 0,
    bounds_crop: false,
    crop_left: 0,
    crop_top: 0,
    crop_right: 0,
    crop_bottom: 0,
    id,
    group_item_backup: false,
    pos: { x: 0.0, y: 0.0 },
    pos_rel: { x: 0.0, y: 0.0 },
    scale: { x: 1.0, y: 1.0 },
    scale_rel: { x: 1.0, y: 1.0 },
    bounds: { x: 0.0, y: 0.0 },
    bounds_rel: { x: 0.0, y: 0.0 },
  };
}

function makeScene(name, items) {
  const scene = sourceBase(name, 'scene', {
    id_counter: items.length + 1,
    custom_size: false,
    items: items.map((src, i) => sceneItem(src, i + 1)),
  });
  return scene;
}

function main() {
  const args = parseArgs(process.argv);
  const outPath = args.out || path.join(process.cwd(), 'CivsNightshift.json');
  const overlayPath = args.overlay || '';
  const musicPath = args.music || '';

  const desktop = sourceBase('Desktop Audio', 'wasapi_output_capture', { device_id: 'default' });
  desktop.volume = 0.5;

  const colorDark = sourceBase('BG Dark', 'color_source_v3', {
    color: 4278190080,
    width: 1920,
    height: 1080,
  });
  const colorQuiet = sourceBase('BG Quiet', 'color_source_v3', {
    color: 4279834905,
    width: 1920,
    height: 1080,
  });

  const textSoon = sourceBase('Text Starting Soon', 'text_gdiplus_v2', {
    text: 'Starting Soon — Civs AI Village',
    font: { face: 'Segoe UI', size: 72, flags: 0 },
    color: 4294967295,
    align: 'center',
    valign: 'center',
  });
  const textBrb = sourceBase('Text BRB', 'text_gdiplus_v2', {
    text: 'Be right back',
    font: { face: 'Segoe UI', size: 72, flags: 0 },
    color: 4294967295,
    align: 'center',
    valign: 'center',
  });
  const textEnd = sourceBase('Text Ending', 'text_gdiplus_v2', {
    text: 'Thanks for watching',
    font: { face: 'Segoe UI', size: 72, flags: 0 },
    color: 4294967295,
    align: 'center',
    valign: 'center',
  });

  const game = sourceBase('Minecraft Capture', 'game_capture', {
    capture_mode: 'any_fullscreen',
    capture_audio: true,
  });

  const music = sourceBase(
    'Music Procedural',
    'ffmpeg_source',
    {
      local_file: musicPath,
      looping: true,
      clear_on_media_end: false,
      restart_on_activate: true,
    },
    { volume: 0.12 },
  );

  const overlay = sourceBase('Cinematic Overlay', 'browser_source', {
    local_file: overlayPath,
    is_local_file: true,
    width: 1920,
    height: 1080,
    css: 'body { background-color: rgba(0,0,0,0); margin: 0px; overflow: hidden; }',
    shutdown: true,
    fps: 30,
  });

  const sceneStarting = makeScene('Starting Soon', [colorDark, textSoon, music]);
  const sceneCinematic = makeScene('Minecraft — Cinematic', [game, overlay, music]);
  const sceneWide = makeScene('Minecraft — Wide', [game, overlay, music]);
  const sceneExplore = makeScene('Minecraft — Exploration', [game, overlay, music]);
  const sceneEvent = makeScene('Minecraft — Event', [game, overlay, music]);
  const sceneAfk = makeScene('Minecraft — AFK Quiet', [game, overlay, music]);
  const sceneBrb = makeScene('BRB', [colorQuiet, textBrb, music]);
  const sceneEnd = makeScene('Stream Ending', [colorDark, textEnd, music]);

  const current = sceneCinematic;

  const collection = {
    name: 'CivsNightshift',
    current_scene: current.name,
    current_program_scene: current.name,
    scene_order: [
      sceneStarting.name,
      sceneCinematic.name,
      sceneWide.name,
      sceneExplore.name,
      sceneEvent.name,
      sceneAfk.name,
      sceneBrb.name,
      sceneEnd.name,
    ],
    DesktopAudioDevice1: desktop,
    sources: [
      colorDark,
      colorQuiet,
      textSoon,
      textBrb,
      textEnd,
      game,
      music,
      overlay,
      sceneStarting,
      sceneCinematic,
      sceneWide,
      sceneExplore,
      sceneEvent,
      sceneAfk,
      sceneBrb,
      sceneEnd,
    ],
    groups: [],
    quick_transitions: [],
    transitions: [],
    saved_projectors: [],
    modules: {},
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(collection, null, 4), 'utf8');
  // Also keep a copy under stream-assets for the repo
  console.log(JSON.stringify({ status: 'PASS', out: outPath, scenes: collection.scene_order.length }));
}

main();
