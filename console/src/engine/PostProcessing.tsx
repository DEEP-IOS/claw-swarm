/**
 * PostProcessing — Native Three.js Bloom via UnrealBloomPass
 *
 * Uses three/examples/jsm EffectComposer + UnrealBloomPass + ShaderPass
 * instead of @react-three/postprocessing to avoid version conflicts.
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// Vignette shader
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    offset: { value: 0.35 },
    darkness: { value: 0.5 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float darkness;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - vec2(0.5)) * vec2(offset);
      float vig = clamp(1.0 - dot(uv, uv), 0.0, 1.0);
      texel.rgb *= mix(1.0 - darkness, 1.0, vig);
      gl_FragColor = texel;
    }
  `,
};

export function PostProcessing() {
  const { gl, scene, camera, size } = useThree();
  const composerRef = useRef<EffectComposer | null>(null);

  useEffect(() => {
    const composer = new EffectComposer(gl);

    // Render pass
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // Bloom pass
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      0.8,     // strength
      0.4,     // radius
      0.25,    // threshold
    );
    composer.addPass(bloomPass);

    // Vignette pass
    const vignettePass = new ShaderPass(VignetteShader);
    composer.addPass(vignettePass);

    composer.setSize(size.width, size.height);
    composerRef.current = composer;

    return () => {
      composer.dispose();
    };
  }, [gl, scene, camera, size.width, size.height]);

  useFrame(() => {
    if (composerRef.current) {
      composerRef.current.render();
    }
  }, 1); // priority 1 = runs after scene rendering

  return null;
}
