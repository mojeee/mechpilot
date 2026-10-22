// The 3D viewer: three.js through @react-three/fiber. Shows the built part's mesh and edges, a
// ground grid, orbit controls, an optional section plane (clipping) and point-to-point measuring.
// M7: picking faces and points as assistant references (Reference mode, or Alt+click while the
// Assistant tab is open) and the translucent preview body of a proposal that changes the part.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewcube, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { t } from '@shared/i18n';
import type { PartMesh } from '@shared/cad/protocol';
import { formatLength } from '@shared/units';
import { useStore } from '../state/store';
import { faceInfo, faceLabel, pointLabel } from '../assistant/faces';

const noRaycast = () => null;

/** The UI accent colour (tokens.css), read again when the theme changes. */
function useAccent(dark: boolean): string {
  return useMemo(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || (dark ? '#4da3ff' : '#1f6fd0'), [dark]);
}

function PartBody({ mesh, clip, dark }: { mesh: PartMesh; clip: THREE.Plane | null; dark: boolean }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    return g;
  }, [mesh]);
  const edges = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.edges, 3));
    return g;
  }, [mesh]);
  useEffect(() => () => {
    geometry.dispose();
    edges.dispose();
  }, [geometry, edges]);
  const planes = clip ? [clip] : [];
  const measure = useStore((s) => s.measure);
  const addMeasurePoint = useStore((s) => s.addMeasurePoint);
  const bodyRef = useRef<THREE.Mesh>(null);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    const st = useStore.getState();
    const as = st.assistant;
    if (as.pick3d || (e.altKey && as.panelOpen)) {
      e.stopPropagation();
      const hit = e.intersections.find((i) => i.object === bodyRef.current);
      const partId = st.activePart;
      const part = partId ? st.editor.doc.parts[partId] : null;
      if (!hit || !part) return;
      const at: [number, number, number] = [hit.point.x, hit.point.y, hit.point.z];
      if (e.shiftKey) {
        as.addReference({ kind: 'point', partId: part.id, at, label: pointLabel(at) });
        return;
      }
      const faceId = hit.faceIndex !== undefined && hit.faceIndex !== null ? mesh.faceIds[hit.faceIndex] : undefined;
      const info = faceId === undefined ? null : faceInfo(mesh, faceId);
      if (!info) return;
      as.addReference({ kind: 'face', partId: part.id, faceId: info.faceId, center: info.center, normal: info.normal, area: info.area, label: faceLabel(info, part.name) });
      return;
    }
    if (!measure) return;
    e.stopPropagation();
    addMeasurePoint([e.point.x, e.point.y, e.point.z]);
  };
  return (
    <group onClick={onClick}>
      <mesh geometry={geometry} ref={bodyRef}>
        <meshStandardMaterial color={dark ? '#9fb3c8' : '#b8c6d6'} metalness={0.15} roughness={0.6} clippingPlanes={planes} clipShadows side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={dark ? '#e8ecf0' : '#1b2027'} clippingPlanes={planes} />
      </lineSegments>
    </group>
  );
}

/** The proposal's body (the part rebuilt from the preview document), translucent over the current one. */
function GhostBody({ mesh, color }: { mesh: PartMesh; color: string }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    return g;
  }, [mesh]);
  const edges = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.edges, 3));
    return g;
  }, [mesh]);
  useEffect(() => () => {
    geometry.dispose();
    edges.dispose();
  }, [geometry, edges]);
  return (
    <group>
      <mesh geometry={geometry} raycast={noRaycast} renderOrder={2}>
        <meshStandardMaterial color={color} transparent opacity={0.45} depthWrite={false} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      <lineSegments geometry={edges} raycast={noRaycast} renderOrder={3}>
        <lineBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
      </lineSegments>
    </group>
  );
}

/** Faces and points the chat refers to: the triangles of each face in the accent colour, a dot per point. */
function ReferenceMarks({ mesh, color }: { mesh: PartMesh | null; color: string }) {
  const partId = useStore((s) => s.activePart);
  const refs = useStore((s) => s.assistant.references);
  const hover = useStore((s) => s.assistant.hoverReference);
  const faces = useMemo(() => {
    if (!mesh) return [];
    const ids = new Map<number, boolean>();
    for (const r of refs) if (r.kind === 'face' && r.partId === partId) ids.set(r.faceId, ids.get(r.faceId) ?? false);
    if (hover?.kind === 'face' && hover.partId === partId) ids.set(hover.faceId, true);
    const out: { key: number; geometry: THREE.BufferGeometry; strong: boolean }[] = [];
    for (const [faceId, strong] of ids) {
      const info = faceInfo(mesh, faceId);
      if (!info) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(info.positions, 3));
      out.push({ key: faceId, geometry: g, strong });
    }
    return out;
  }, [mesh, refs, hover, partId]);
  useEffect(() => () => faces.forEach((f) => f.geometry.dispose()), [faces]);
  const points = [...refs, ...(hover ? [hover] : [])].flatMap((r) => (r.kind === 'point' && (r.partId === null || r.partId === partId) ? [r.at] : []));
  return (
    <group>
      {faces.map((f) => (
        <mesh key={f.key} geometry={f.geometry} raycast={noRaycast} renderOrder={4}>
          <meshBasicMaterial color={color} transparent opacity={f.strong ? 0.75 : 0.5} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} depthWrite={false} />
        </mesh>
      ))}
      {points.map((p, i) => (
        <mesh key={i} position={p} raycast={noRaycast} renderOrder={5}>
          <sphereGeometry args={[0.8, 12, 12]} />
          <meshBasicMaterial color={color} depthTest={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Fit the camera to the mesh's bounding box once per mesh. */
function FitCamera({ bbox }: { bbox: { min: [number, number, number]; max: [number, number, number] } | null }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update(): void } | null };
  useEffect(() => {
    if (!bbox) return;
    const c = new THREE.Vector3((bbox.min[0] + bbox.max[0]) / 2, (bbox.min[1] + bbox.max[1]) / 2, (bbox.min[2] + bbox.max[2]) / 2);
    const size = Math.max(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2], 1);
    const d = size * 1.8;
    camera.position.set(c.x + d * 0.8, c.y - d * 0.9, c.z + d * 0.7);
    camera.near = size / 100;
    camera.far = size * 50;
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(c);
      controls.update();
    } else camera.lookAt(c);
  }, [bbox, camera, controls]);
  return null;
}

function MeasureMarks({ points }: { points: [number, number, number][] }) {
  const line = useMemo(() => {
    if (points.length < 2) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...points[0], ...points[1]]), 3));
    return g;
  }, [points]);
  return (
    <group>
      {points.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.6, 12, 12]} />
          <meshBasicMaterial color="#ffb020" />
        </mesh>
      ))}
      {line && (
        <lineSegments geometry={line}>
          <lineBasicMaterial color="#ffb020" />
        </lineSegments>
      )}
    </group>
  );
}

export function Viewer3D() {
  const build = useStore((s) => s.build);
  const building = useStore((s) => s.building);
  const section = useStore((s) => s.section);
  const measure = useStore((s) => s.measure);
  const measurePoints = useStore((s) => s.measurePoints);
  const dark = useStore((s) => s.settings.theme === 'dark');
  const part = useStore((s) => (s.activePart ? s.editor.doc.parts[s.activePart] : null));
  const [hover, setHover] = useState<string | null>(null);
  const accent = useAccent(dark);
  const pick3d = useStore((s) => s.assistant.pick3d);
  const togglePick3d = useStore((s) => s.assistant.togglePick3d);
  const panelOpen = useStore((s) => s.assistant.panelOpen);
  const preview = useStore((s) => s.assistant.preview);
  const activePart = useStore((s) => s.activePart);
  const ghost = preview?.part && preview.part.partId === activePart && preview.activePart === activePart ? preview.part : null;
  const clip = useMemo(() => {
    if (!section) return null;
    const n = section.plane === 'XY' ? new THREE.Vector3(0, 0, -1) : section.plane === 'XZ' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(-1, 0, 0);
    // Keep the half-space below the plane: n · p + d >= 0 is kept by three.js clipping.
    return new THREE.Plane(n, section.offset);
  }, [section]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const bbox = build?.properties?.bbox ?? null;
  const dist = measurePoints.length === 2 ? Math.hypot(measurePoints[1][0] - measurePoints[0][0], measurePoints[1][1] - measurePoints[0][1], measurePoints[1][2] - measurePoints[0][2]) : null;
  return (
    <div className="viewer-wrap" ref={wrapRef} data-measure={measure || pick3d ? 'on' : 'off'}>
      <Canvas camera={{ position: [120, -140, 100], up: [0, 0, 1], fov: 40, near: 1, far: 10000 }} gl={{ localClippingEnabled: true, antialias: true }} style={{ background: dark ? '#0f1216' : '#ffffff' }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[200, -150, 300]} intensity={1.1} />
        <directionalLight position={[-150, 200, -100]} intensity={0.4} />
        <Grid args={[1000, 1000]} cellSize={10} sectionSize={100} rotation={[Math.PI / 2, 0, 0]} cellColor={dark ? '#2b333e' : '#d3dae2'} sectionColor={dark ? '#3a4452' : '#b8c2cc'} fadeDistance={1500} infiniteGrid />
        {build?.mesh && <PartBody mesh={build.mesh} clip={clip} dark={dark} />}
        {ghost?.mesh && <GhostBody mesh={ghost.mesh} color={accent} />}
        <ReferenceMarks mesh={build?.mesh ?? null} color={accent} />
        <MeasureMarks points={measurePoints} />
        <FitCamera bbox={bbox} />
        <OrbitControls makeDefault enableDamping={false} />
        <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
          <GizmoViewcube faces={['RIGHT', 'LEFT', 'BACK', 'FRONT', 'TOP', 'BOTTOM']} />
        </GizmoHelper>
      </Canvas>
      <div className="viewer-hud">
        {part && <span className="mono">{part.name}</span>}
        {building && <span className="dim">{t('Building…')}</span>}
        {build && !building && build.errors.length > 0 && <span className="err">{t('{n} features failed', { n: build.errors.length })}</span>}
        {build?.properties && <span className="dim">{t('Volume {v} cm³', { v: (build.properties.volume / 1000).toFixed(3).replace('.', ',') })}</span>}
        {measure && <span className="warn">{dist !== null ? t('Distance {d}', { d: formatLength(dist) }) : t('Measure: click two points on the part')}</span>}
        {hover && <span className="dim">{hover}</span>}
        {ghost && <span className="accent">{ghost.building ? t('Building the preview…') : ghost.error ? t('Preview: {reason}', { reason: ghost.error }) : t('Preview of the proposal')}</span>}
        {pick3d && <span className="accent">{t('Click a face to add it to the chat; Shift+click adds a point.')}</span>}
        {!pick3d && panelOpen && part && <span className="dim">{t('Alt+click a face to add it to the chat')}</span>}
      </div>
      {part && (
        <div className="viewer-tools">
          <button className={`btn small ${pick3d ? 'on' : ''}`} aria-pressed={pick3d} onClick={togglePick3d} title={t('Reference mode: click a face or a point of the part to add it to the assistant chat')}>
            {t('Reference')}
          </button>
        </div>
      )}
      {!part && (
        <div className="viewer-empty">
          <p>{t('No part yet. Draw a closed outline in Model, select it and type SKETCH, then EXTRUDE.')}</p>
        </div>
      )}
      <span style={{ display: 'none' }} onMouseEnter={() => setHover(null)} />
    </div>
  );
}
