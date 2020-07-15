import { _decorator, Component, Node, RenderStage, RenderFlow, RenderView, renderer, GFXClearFlag, GFXPipelineState, GFXCommandBuffer, GFXTextureType, GFXTextureUsageBit, GFXTextureViewType, GFXFormat, Vec2, GFXFramebuffer, GFXTexture, GFXTextureView, pipeline, game, director, Director, IGFXColor, Mat4, CameraComponent, GFXBindingType, GFXBufferUsageBit, GFXMemoryUsageBit, GFXUniformBlock, GFXBuffer, Vec3, ModelComponent } from "cc";
import { createFrameBuffer } from "../utils/frame-buffer";
import { DepthBufferComponent } from "./depth-buffer-component";
import { UBOLitShadow } from "./shadow-map-ubo";
import { ShadowComponent } from "./shadow-component";

const { ccclass, property } = _decorator;

const _colors: IGFXColor[] = [{ r: 1, g: 1, b: 1, a: 1 }];
const _bufs: GFXCommandBuffer[] = [];

type ShadowMapBinding = {
    type: GFXBindingType,
    blockInfo: GFXUniformBlock,
    buffer: GFXBuffer,
    ubo: UBOLitShadow,
}

type ShadowMap = {
    buffer: GFXFramebuffer,
    binding: ShadowMapBinding
}

let _viewMat = new Mat4;
let _projMat = new Mat4;
let _viewProjMat = new Mat4;
function _computeDirectionalLightViewProjMatrix (light: renderer.Light, min = 0.1, max = 1000) {
    // view matrix
    light.node.getWorldRT(_viewMat);
    Mat4.invert(_viewMat, _viewMat);

    // TODO: should compute directional light frustum based on rendered meshes in scene.
    // proj matrix
    let halfSize = 10 / 2; //light._shadowFrustumSize / 2;
    // min = min || light._shadowMinDepth;
    // max = max || light._shadowMaxDepth;
    Mat4.ortho(_projMat, -halfSize, halfSize, -halfSize, halfSize, min, max);
    // Mat4.perspective(_projMat, 60, 1, min, max);

    Mat4.multiply(_viewProjMat, _projMat, _viewMat);
    return _viewProjMat;
}

// TODO: only support bind one depth buffer now.
@ccclass("ShadowMapStage")
export class ShadowMapStage extends RenderStage {

    _psos: GFXPipelineState[] = []

    _shadowMap: ShadowMap = null;

    _shadowComponent: ShadowComponent = null;

    public activate (flow: RenderFlow) {
        super.activate(flow);
        this.createCmdBuffer();
    }

    /**
     * @zh
     * 销毁函数。
     */
    public destroy () {
        if (this._cmdBuff) {
            this._cmdBuff.destroy();
            this._cmdBuff = null;
        }
    }

    public sortRenderQueue () {
        let shadowMap = this._shadowMap.buffer.colorViews[0];
        let buffer = this._shadowMap.binding.buffer;

        this._renderQueues.forEach(this.renderQueueClearFunc);
        const renderObjects = this._pipeline.renderObjects;
        for (let i = 0; i < renderObjects.length; ++i) {
            const ro = renderObjects[i];
            const model = ro.model;
            const modelComp = model.node.getComponent(ModelComponent);
            const receiveShadow = modelComp.lightmapSettings.receiveShadow;
            const castShadow = modelComp.lightmapSettings.castShadow;

            for (let l = 0; l < model.subModelNum; l++) {
                let passes = model.getSubModel(l).passes;
                for (let j = 0; j < passes.length; j++) {
                    for (let k = 0; k < this._renderQueues.length; k++) {
                        let updated = false;

                        if (castShadow) {
                            this._renderQueues[k].insertRenderPass(ro, l, j)
                        }

                        const subModel = model.getSubModel(l);
                        const pass: renderer.Pass = subModel.passes[j];
                      
                        // if (castShadow || receiveShadow) {
                        // @ts-ignore
                        if (!pass.binded_sl_lit_shadow_shadowStage) {
                            if (pass.getBinding('sl_litShadowMatViewProj') !== undefined) {
                                pass.bindBuffer(UBOLitShadow.BLOCK.binding, buffer);
                                updated = true;
                                // @ts-ignore
                                pass.binded_sl_lit_shadow_shadowStage = true;
                            }
                        }
                        // }

                        // if (receiveShadow) {
                        // @ts-ignore
                        if (!pass.binded_sl_shadowMap_shadowStage) {
                            let sampler = pass.getBinding('sl_shadowMap');
                            if (sampler) {
                                pass.bindTextureView(sampler, shadowMap);
                                updated = true;
                                // @ts-ignore
                                pass.binded_sl_shadowMap_shadowStage = true;
                            }
                        }
                        // }


                        if (updated) {
                            pass.update();
                        }
                    }
                }
            }
        }

        this._renderQueues.forEach(this.renderQueueSortFunc);
    }

    switchBuffer () {
        let shadowMap = this._shadowMap;
        // @ts-ignore
        if (!shadowMap || !shadowMap.binding.buffer._gpuBuffer) {
            const buffer = this.pipeline.device.createBuffer({
                usage: GFXBufferUsageBit.UNIFORM | GFXBufferUsageBit.TRANSFER_DST,
                memUsage: GFXMemoryUsageBit.HOST | GFXMemoryUsageBit.DEVICE,
                size: UBOLitShadow.SIZE,
            });

            let uboLitShadow = new UBOLitShadow();

            let uboBinding = {
                type: GFXBindingType.UNIFORM_BUFFER,
                blockInfo: UBOLitShadow.BLOCK,
                buffer: buffer,
                ubo: uboLitShadow,
            };

            shadowMap = {
                buffer: createFrameBuffer(this._pipeline, this._device, true),
                binding: uboBinding
            }

            this._shadowMap = shadowMap;
        }

        return true;
    }

    updateUBO (camera: renderer.Camera) {
        let uboBinding = this._shadowMap.binding;
        const fv = uboBinding.ubo.view;

        let nearClip = 0.1;
        let farClip = 1000;

        let mainLight = camera.scene.mainLight;
        // let matViewProj = _computeDirectionalLightViewProjMatrix(mainLight, nearClip, farClip);
        let matViewProj = cc.find('Main Light/Camera').getComponent(CameraComponent).camera.matViewProj;

        Mat4.toArray(fv, matViewProj, UBOLitShadow.LIT_SHADOW_MAT_VIEW_PROJ_OFFSET);

        fv[UBOLitShadow.LIT_SHADOW_PARAMS] = nearClip;
        fv[UBOLitShadow.LIT_SHADOW_PARAMS + 1] = farClip;
        fv[UBOLitShadow.LIT_SHADOW_PARAMS + 2] = this._shadowComponent.shadowBias;
        fv[UBOLitShadow.LIT_SHADOW_PARAMS + 3] = this._shadowComponent.shadowDarkness;

        uboBinding.buffer!.update(fv);
    }

    checkView (view: RenderView) {
        const camera = view.camera!;

        // @ts-ignore
        if (CC_EDITOR && view.name !== "Editor Camera") {
            return false;
        }

        let light = camera.scene.mainLight;
        if (!light) return false;
        let shadow = light.node.getComponent(ShadowComponent);
        if (!shadow || !shadow.enabledInHierarchy) {
            return false;
        }

        this._shadowComponent = shadow;
        return true;
    }

    render (view: RenderView) {
        if (!this.checkView(view)) {
            return;
        }

        this.switchBuffer();

        const camera = view.camera!;
        this.updateUBO(camera);
        this.sortRenderQueue();

        let cmdBuff = this._cmdBuff;
        cmdBuff.begin();

        const vp = camera.viewport;
        this._renderArea!.x = vp.x * camera.width;
        this._renderArea!.y = vp.y * camera.height;


        let framebuffer = this._shadowMap.buffer;
        this._renderArea!.width = camera.width;
        this._renderArea!.height = camera.height;

        cmdBuff.beginRenderPass(framebuffer, this._renderArea!,
            camera.clearFlag, _colors, camera.clearDepth, camera.clearStencil);

        for (let i = 0; i < this._renderQueues.length; i++) {
            cmdBuff.execute(this._renderQueues[i].cmdBuffs.array, this._renderQueues[i].cmdBuffCount);
        }

        cmdBuff.endRenderPass();

        cmdBuff.end();

        _bufs.length = 0;
        _bufs[0] = cmdBuff;
        this._device!.queue.submit(_bufs);
    }

    resize (width: number, height: number) {
        this.rebuild();
    }
    rebuild () {
        if (this._shadowMap) {
            this._shadowMap.buffer.destroy();
            this._shadowMap = null;
        }
    }
}
