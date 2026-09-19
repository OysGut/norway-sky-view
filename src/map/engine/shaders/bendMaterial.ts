// LOCKED: engine code — modify only on explicit engine tasks.
//
// Makes any three.js built-in material take part in the Bent World by patching
// its vertex shader with onBeforeCompile: the world-space position is bent with
// bendWorldTheta() before view/projection, and (for lit materials) the normal is
// rotated with the bend. Materials patched this way share ONE uniform set, so
// updating the uniforms once per frame moves everything.
//
// Caveat: three's morph/skinning/displacement chunks modify `transformed` after
// begin_vertex; terrain and markers do not use them, so the bent position is
// computed once at begin_vertex.

import type { Material, WebGLProgramParametersWithUniforms } from "three";

import { BEND_GLSL, type BendUniforms } from "./bend.glsl";

const BEGIN_VERTEX = "#include <begin_vertex>";
const DEFAULTNORMAL_VERTEX = "#include <defaultnormal_vertex>";
const PROJECT_VERTEX = "#include <project_vertex>";
const WORLDPOS_VERTEX = "#include <worldpos_vertex>";

// Bend the world-space position right after `transformed` is defined.
const BENT_BEGIN_VERTEX = /* glsl */ `
vec3 transformed = vec3( position );
vec4 bentWorldPosition = modelMatrix * vec4( transformed, 1.0 );
bentWorldPosition.xyz = bendWorld( bentWorldPosition.xyz );
`;

// Lit materials: rotate the world normal with the bend, then bring it to view space
// (three expects `transformedNormal` in view space for lighting). In lit shaders the
// normal chunk runs BEFORE begin_vertex, so theta is computed here from `position`.
const BENT_DEFAULTNORMAL_VERTEX = /* glsl */ `
float bentTheta = 0.0;
float bentSgn = 1.0;
{
  vec4 bentNormalWorldPosition = modelMatrix * vec4( position, 1.0 );
  bendWorldTheta( bentNormalWorldPosition.xyz, bentTheta, bentSgn );
}
vec3 bentWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );
bentWorldNormal = bendNormal( bentWorldNormal, bentTheta, bentSgn );
vec3 transformedNormal = normalize( mat3( viewMatrix ) * bentWorldNormal );
#ifdef FLIP_SIDED
  transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
  vec3 transformedTangent = ( modelViewMatrix * vec4( objectTangent, 0.0 ) ).xyz;
  #ifdef FLIP_SIDED
    transformedTangent = - transformedTangent;
  #endif
#endif
`;

const BENT_PROJECT_VERTEX = /* glsl */ `
vec4 mvPosition = viewMatrix * bentWorldPosition;
gl_Position = projectionMatrix * mvPosition;
`;

// worldpos_vertex is used by fog/shadows/env maps; keep it consistent with the bent position.
const BENT_WORLDPOS_VERTEX = /* glsl */ `
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
  vec4 worldPosition = bentWorldPosition;
#endif
`;

/**
 * Patch a material so its vertices are bent. Safe to call once per material
 * instance; the uniform object is shared by reference.
 */
export function applyBendToMaterial<M extends Material>(material: M, uniforms: BendUniforms): M {
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    if (!shader.vertexShader.includes("bendWorld(")) {
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", `${BEND_GLSL}\nvoid main() {`)
        .replace(BEGIN_VERTEX, BENT_BEGIN_VERTEX)
        .replace(DEFAULTNORMAL_VERTEX, BENT_DEFAULTNORMAL_VERTEX)
        .replace(PROJECT_VERTEX, BENT_PROJECT_VERTEX)
        .replace(WORLDPOS_VERTEX, BENT_WORLDPOS_VERTEX);
    }
  };
  // Different shader text → different program cache key.
  material.customProgramCacheKey = () => "himinrond-bend-v2";
  material.needsUpdate = true;
  return material;
}
