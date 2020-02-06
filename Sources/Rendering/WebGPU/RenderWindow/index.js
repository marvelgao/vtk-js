import macro from 'vtk.js/Sources/macro';
import vtkForwardPass from 'vtk.js/Sources/Rendering/WebGPU/ForwardPass';
import vtkWebGPUPipeline from 'vtk.js/Sources/Rendering/WebGPU/Pipeline';
import vtkWebGPUViewNodeFactory from 'vtk.js/Sources/Rendering/WebGPU/ViewNodeFactory';
import vtkShaderCache from 'vtk.js/Sources/Rendering/WebGPU/ShaderCache';
import vtkViewNode from 'vtk.js/Sources/Rendering/SceneGraph/ViewNode';

const { vtkErrorMacro } = macro;

// ----------------------------------------------------------------------------
// vtkWebGPURenderWindow methods
// ----------------------------------------------------------------------------

function vtkWebGPURenderWindow(publicAPI, model) {
  // Set our className
  model.classHierarchy.push('vtkWebGPURenderWindow');

  // Auto update style
  function updateWindow() {
    // Canvas size
    if (model.renderable) {
      model.canvas.setAttribute('width', model.size[0]);
      model.canvas.setAttribute('height', model.size[1]);
    }

    // ImageStream size
    if (model.viewStream) {
      // If same size that's a NoOp
      model.viewStream.setSize(model.size[0], model.size[1]);
    }

    // Offscreen ?
    model.canvas.style.display = model.useOffScreen ? 'none' : 'block';

    // Cursor type
    if (model.el) {
      model.el.style.cursor = model.cursorVisibility ? model.cursor : 'none';
    }

    // Invalidate cached DOM container size
    model.containerSize = null;
  }
  publicAPI.onModified(updateWindow);

  // Builds myself.
  publicAPI.buildPass = (prepass) => {
    if (prepass) {
      if (!model.renderable) {
        return;
      }

      publicAPI.prepareNodes();
      publicAPI.addMissingNodes(model.renderable.getRenderersByReference());
      publicAPI.removeUnusedNodes();

      model.children.forEach((child) => {
        child.setWebGPURenderWindow(publicAPI);
      });
    }
  };

  publicAPI.initialize = async () => {
    if (!model.initialized) {
      model.adapter = await navigator.gpu.requestAdapter();
      model.device = await model.adapter.requestDevice();
      /* eslint-disable */
      const glslangModule = await import(
        /* webpackIgnore: true */ 'https://unpkg.com/@webgpu/glslang@0.0.12/dist/web-devel/glslang.js'
      );
      /* eslint-enable */
      model.glslang = await glslangModule.default();

      model.context = model.canvas.getContext('gpupresent');

      if (!model.context) {
        vtkErrorMacro('unable to find webgpu support');
      }

      model.swapChain = model.context.configureSwapChain({
        device: model.device,
        format: 'bgra8unorm',
      });

      /* eslint-disable */
      model.depthTexture = model.device.createTexture({
        size: {
          width: model.canvas.width,
          height: model.canvas.height,
          depth: 1,
        },
        format: 'depth24plus-stencil8',
        usage: GPUTextureUsage.OUTPUT_ATTACHMENT,
      });
      /* eslint-enable */

      model.shaderCache.setContext(model.context);
      model.initialized = true;
    }
  };

  publicAPI.setContainer = (el) => {
    if (model.el && model.el !== el) {
      if (model.canvas.parentNode !== model.el) {
        vtkErrorMacro('Error: canvas parent node does not match container');
      }

      // Remove canvas from previous container
      model.el.removeChild(model.canvas);

      // If the renderer has previously added
      // a background image, remove it from the DOM.
      if (model.el.contains(model.bgImage)) {
        model.el.removeChild(model.bgImage);
      }
    }

    if (model.el !== el) {
      model.el = el;
      if (model.el) {
        model.el.appendChild(model.canvas);
      }

      // If the renderer is set to use a background
      // image, attach it to the DOM.
      if (model.useBackgroundImage) {
        model.el.appendChild(model.bgImage);
      }

      // Trigger modified()
      publicAPI.modified();
    }
  };

  publicAPI.getContainer = () => model.el;

  publicAPI.getContainerSize = () => {
    if (!model.containerSize && model.el) {
      const { width, height } = model.el.getBoundingClientRect();
      model.containerSize = [width, height];
    }
    return model.containerSize || model.size;
  };

  publicAPI.getFramebufferSize = () => {
    if (model.activeFramebuffer) {
      return model.activeFramebuffer.getSize();
    }
    return model.size;
  };

  publicAPI.isInViewport = (x, y, viewport) => {
    const vCoords = viewport.getViewportByReference();
    const size = publicAPI.getFramebufferSize();
    if (
      vCoords[0] * size[0] <= x &&
      vCoords[2] * size[0] >= x &&
      vCoords[1] * size[1] <= y &&
      vCoords[3] * size[1] >= y
    ) {
      return true;
    }
    return false;
  };

  publicAPI.getViewportSize = (viewport) => {
    const vCoords = viewport.getViewportByReference();
    const size = publicAPI.getFramebufferSize();

    return [
      (vCoords[2] - vCoords[0]) * size[0],
      (vCoords[3] - vCoords[1]) * size[1],
    ];
  };

  publicAPI.getViewportCenter = (viewport) => {
    const size = publicAPI.getViewportSize(viewport);
    return [size[0] * 0.5, size[1] * 0.5];
  };

  publicAPI.displayToNormalizedDisplay = (x, y, z) => {
    const size = publicAPI.getFramebufferSize();
    return [x / size[0], y / size[1], z];
  };

  publicAPI.normalizedDisplayToDisplay = (x, y, z) => {
    const size = publicAPI.getFramebufferSize();
    return [x * size[0], y * size[1], z];
  };

  publicAPI.worldToView = (x, y, z, renderer) => {
    const dims = publicAPI.getViewportSize(renderer);
    return renderer.worldToView(x, y, z, dims[0] / dims[1]);
  };

  publicAPI.viewToWorld = (x, y, z, renderer) => {
    const dims = publicAPI.getViewportSize(renderer);
    return renderer.viewToWorld(x, y, z, dims[0] / dims[1]);
  };

  publicAPI.worldToDisplay = (x, y, z, renderer) => {
    const val = publicAPI.worldToView(x, y, z, renderer);
    const val2 = renderer.viewToNormalizedDisplay(val[0], val[1], val[2]);
    return publicAPI.normalizedDisplayToDisplay(val2[0], val2[1], val2[2]);
  };

  publicAPI.displayToWorld = (x, y, z, renderer) => {
    const val = publicAPI.displayToNormalizedDisplay(x, y, z);
    const val2 = renderer.normalizedDisplayToView(val[0], val[1], val[2]);
    return publicAPI.viewToWorld(val2[0], val2[1], val2[2], renderer);
  };

  publicAPI.normalizedDisplayToViewport = (x, y, z, renderer) => {
    let vCoords = renderer.getViewportByReference();
    vCoords = publicAPI.normalizedDisplayToDisplay(vCoords[0], vCoords[1], 0.0);
    const coords = publicAPI.normalizedDisplayToDisplay(x, y, z);
    return [coords[0] - vCoords[0] - 0.5, coords[1] - vCoords[1] - 0.5, z];
  };

  publicAPI.viewportToNormalizedViewport = (x, y, z, renderer) => {
    const size = publicAPI.getViewportSize(renderer);
    if (size && size[0] !== 0 && size[1] !== 0) {
      return [x / (size[0] - 1.0), y / (size[1] - 1.0), z];
    }
    return [x, y, z];
  };

  publicAPI.normalizedViewportToViewport = (x, y, z) => {
    const size = publicAPI.getFramebufferSize();
    return [x * (size[0] - 1.0), y * (size[1] - 1.0), z];
  };

  publicAPI.displayToLocalDisplay = (x, y, z) => {
    const size = publicAPI.getFramebufferSize();
    return [x, size[1] - y - 1, z];
  };

  publicAPI.viewportToNormalizedDisplay = (x, y, z, renderer) => {
    let vCoords = renderer.getViewportByReference();
    vCoords = publicAPI.normalizedDisplayToDisplay(vCoords[0], vCoords[1], 0.0);
    const x2 = x + vCoords[0] + 0.5;
    const y2 = y + vCoords[1] + 0.5;
    return publicAPI.displayToNormalizedDisplay(x2, y2, z);
  };

  publicAPI.setBackgroundImage = (img) => {
    model.bgImage.src = img.src;
  };

  publicAPI.setUseBackgroundImage = (value) => {
    model.useBackgroundImage = value;

    // Add or remove the background image from the
    // DOM as specified.
    if (model.useBackgroundImage && !model.el.contains(model.bgImage)) {
      model.el.appendChild(model.bgImage);
    } else if (!model.useBackgroundImage && model.el.contains(model.bgImage)) {
      model.el.removeChild(model.bgImage);
    }
  };

  function getCanvasDataURL(format = model.imageFormat) {
    // Copy current canvas to not modify the original
    const temporaryCanvas = document.createElement('canvas');
    const temporaryContext = temporaryCanvas.getContext('2d');
    temporaryCanvas.width = model.canvas.width;
    temporaryCanvas.height = model.canvas.height;
    temporaryContext.drawImage(model.canvas, 0, 0);

    // Get current client rect to place canvas
    const mainBoundingClientRect = model.canvas.getBoundingClientRect();

    const renderWindow = model.renderable;
    const renderers = renderWindow.getRenderers();
    renderers.forEach((renderer) => {
      const viewProps = renderer.getViewProps();
      viewProps.forEach((viewProp) => {
        // Check if the prop has a container that should have canvas
        if (viewProp.getContainer) {
          const container = viewProp.getContainer();
          const canvasList = container.getElementsByTagName('canvas');
          // Go throughout all canvas and copy it into temporary main canvas
          for (let i = 0; i < canvasList.length; i++) {
            const currentCanvas = canvasList[i];
            const boundingClientRect = currentCanvas.getBoundingClientRect();
            const newXPosition =
              boundingClientRect.x - mainBoundingClientRect.x;
            const newYPosition =
              boundingClientRect.y - mainBoundingClientRect.y;
            temporaryContext.drawImage(
              currentCanvas,
              newXPosition,
              newYPosition
            );
          }
        }
      });
    });

    const screenshot = temporaryCanvas.toDataURL(format);
    temporaryCanvas.remove();
    publicAPI.invokeImageReady(screenshot);
  }

  publicAPI.captureNextImage = (format = 'image/png') => {
    if (model.deleted) {
      return null;
    }
    model.imageFormat = format;
    const previous = model.notifyStartCaptureImage;
    model.notifyStartCaptureImage = true;

    return new Promise((resolve, reject) => {
      const subscription = publicAPI.onImageReady((imageURL) => {
        model.notifyStartCaptureImage = previous;
        subscription.unsubscribe();
        resolve(imageURL);
      });
    });
  };

  publicAPI.traverseAllPasses = () => {
    publicAPI.initialize();
    if (model.initialized) {
      model.commandEncoder = model.device.createCommandEncoder({});
      if (model.renderPasses) {
        for (let index = 0; index < model.renderPasses.length; ++index) {
          model.renderPasses[index].traverse(publicAPI, null);
        }
      }
      model.device.defaultQueue.submit([model.commandEncoder.finish()]);

      if (model.notifyStartCaptureImage) {
        getCanvasDataURL();
      }
    }
  };

  publicAPI.setViewStream = (stream) => {
    if (model.viewStream === stream) {
      return false;
    }
    if (model.subscription) {
      model.subscription.unsubscribe();
      model.subscription = null;
    }
    model.viewStream = stream;
    if (model.viewStream) {
      // Force background to be transparent + render
      const mainRenderer = model.renderable.getRenderers()[0];
      mainRenderer.getBackgroundByReference()[3] = 0;

      // Enable display of the background image
      publicAPI.setUseBackgroundImage(true);

      // Bind to remote stream
      model.subscription = model.viewStream.onImageReady((e) =>
        publicAPI.setBackgroundImage(e.image)
      );
      model.viewStream.setSize(model.size[0], model.size[1]);
      model.viewStream.invalidateCache();
      model.viewStream.render();

      publicAPI.modified();
    }
    return true;
  };

  publicAPI.getPipeline = (name) => {
    if (model.pipelines.has(name)) {
      return model.pipelines.get(name);
    }
    model.pipelines.set(name, vtkWebGPUPipeline.newInstance());
    model.pipelines.get(name).initialize(publicAPI);
    return model.pipelines.get(name);
  };

  publicAPI.delete = macro.chain(publicAPI.delete, publicAPI.setViewStream);
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {
  initialized: false,
  canvas: null,
  size: [300, 300],
  cursorVisibility: true,
  cursor: 'pointer',
  containerSize: null,
  renderPasses: [],
  notifyStartCaptureImage: false,
  activeFramebuffer: null,
  imageFormat: 'image/png',
  useOffScreen: false,
  useBackgroundImage: false,
  pipelines: null,
  device: null,
  glslang: null,
};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  // Create internal instances
  model.canvas = document.createElement('canvas');
  model.canvas.style.width = '100%';

  // Create internal bgImage
  model.bgImage = new Image();
  model.bgImage.style.position = 'absolute';
  model.bgImage.style.left = '0';
  model.bgImage.style.top = '0';
  model.bgImage.style.width = '100%';
  model.bgImage.style.height = '100%';
  model.bgImage.style.zIndex = '-1';

  model.pipelines = new Map();

  // Inheritance
  vtkViewNode.extend(publicAPI, model, initialValues);

  model.myFactory = vtkWebGPUViewNodeFactory.newInstance();
  /* eslint-disable no-use-before-define */
  model.myFactory.registerOverride('vtkRenderWindow', newInstance);
  /* eslint-enable no-use-before-define */

  model.shaderCache = vtkShaderCache.newInstance();
  model.shaderCache.setWebGPURenderWindow(publicAPI);

  // setup default forward pass rendering
  model.renderPasses[0] = vtkForwardPass.newInstance();

  macro.event(publicAPI, model, 'imageReady');

  // Build VTK API
  macro.get(publicAPI, model, [
    'commandEncoder',
    'useBackgroundImage',
    'device',
    'depthTexture',
    'glslang',
    'passEncoder',
    'swapChain',
  ]);

  macro.setGet(publicAPI, model, [
    'initialized',
    'context',
    'canvas',
    'renderPasses',
    'notifyStartCaptureImage',
    'cursor',
    'useOffScreen',
    // might want to make this not call modified as
    // we change the active framebuffer a lot. Or maybe
    // only mark modified if the size or depth
    // of the buffer has changed
    'activeFramebuffer',
  ]);

  macro.setGetArray(publicAPI, model, ['size'], 2);

  // Object methods
  vtkWebGPURenderWindow(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(extend, 'vtkWebGPURenderWindow');

// ----------------------------------------------------------------------------

export default {
  newInstance,
  extend,
};
