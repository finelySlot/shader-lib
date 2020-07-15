import { _decorator, Component, Node, RenderStage, RenderFlow, RenderView, renderer, GFXClearFlag, GFXPipelineState, GFXCommandBuffer, GFXTextureType, GFXTextureUsageBit, GFXTextureViewType, GFXFormat, Vec2, GFXFramebuffer, GFXTexture, GFXTextureView, pipeline, game, director, Director, IGFXColor, Mat4, CameraComponent, GFXBindingType, GFXBufferUsageBit, GFXMemoryUsageBit, GFXUniformBlock, GFXBuffer } from "cc";
import { createFrameBuffer } from "../utils/frame-buffer";
import { DepthBufferComponent } from "./depth-buffer-component";
import { UBOLitShadow } from "./shadow-map-ubo";
import { ShadowMapStage } from "./shadow-map-stage";

const { ccclass, property } = _decorator;


// TODO: only support bind one depth buffer now.
@ccclass("DepthBufferStage")
export class DepthBufferStage extends ShadowMapStage {

    public sortRenderQueue () {
        let shadowMap = this._shadowMap.buffer.colorViews[0];
        let buffer = this._shadowMap.binding.buffer;

        this._renderQueues.forEach(this.renderQueueClearFunc);
        const renderObjects = this._pipeline.renderObjects;
        for (let i = 0; i < renderObjects.length; ++i) {
            const ro = renderObjects[i];
            for (let l = 0; l < ro.model.subModelNum; l++) {
                let passes = ro.model.getSubModel(l).passes;
                for (let j = 0; j < passes.length; j++) {
                    for (let k = 0; k < this._renderQueues.length; k++) {
                        let updated = false;

                        const subModel = ro.model.getSubModel(l);
                        const pass: renderer.Pass = subModel.passes[j];

                        this._renderQueues[k].insertRenderPass(ro, l, j)

                        // @ts-ignore
                        if (!pass.binded_sl_lit_shadow) {
                            if (pass.getBinding('sl_litShadowMatViewProj') !== undefined) {
                                pass.bindBuffer(UBOLitShadow.BLOCK.binding, buffer);
                                updated = true;
                                // @ts-ignore
                                pass.binded_sl_lit_shadow = true;
                            }
                        }

                        // @ts-ignore
                        if (!pass.binded_sl_shadowMap) {
                            let sampler = pass.getBinding('sl_depthTexture');
                            if (sampler) {
                                pass.bindTextureView(sampler, shadowMap);
                                updated = true;
                                // @ts-ignore
                                pass.binded_sl_shadowMap = true;
                            }
                        }

                        if (updated) {
                            pass.update();
                        }
                    }
                }
            }
        }

        this._renderQueues.forEach(this.renderQueueSortFunc);
    }

    updateUBO (camera: renderer.Camera) {
        let uboBinding = this._shadowMap.binding;
        const fv = uboBinding.ubo.view;

        Mat4.toArray(fv, camera.matViewProj, UBOLitShadow.LIT_SHADOW_MAT_VIEW_PROJ_OFFSET);

        fv[UBOLitShadow.LIT_SHADOW_PARAMS] = camera.nearClip;
        fv[UBOLitShadow.LIT_SHADOW_PARAMS + 1] = camera.farClip;
        fv[UBOLitShadow.LIT_SHADOW_PARAMS + 2] = 0;

        uboBinding.buffer!.update(fv);
    }

    checkView (view) {
        const camera = view.camera!;

        // @ts-ignore
        if (!CC_EDITOR) {
            let depthComponent = camera.node.getComponent(DepthBufferComponent);
            if (!depthComponent || !depthComponent.enabled) {
                return false;
            }
        }
        else if (view.name !== "Editor Camera") {
            return false;
        }

        return true;
    }
}
