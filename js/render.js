// render.js
// Rendering functions
//

var THREE = require("three"),
	$ = require('jquery');

	require("trackball-controls");
	require("binary-loader");

(function(w) {
	"use strict";

	var container, stats;
	var camera, controls, scene, renderer;
	var activeCamera, orthoCamera, topViewCamera;

	var cross;

	var mensurationMode = false;

	function CameraControl(container) {
		this.container = container;
		this.cameras = {};

		this.active = null;
	}

	CameraControl.prototype.addCamera = function(name, camera, noRotate, noPan) {
		var controls = new THREE.TrackballControls(camera, this.container);

		controls.noRotate = (noRotate === undefined ? false : noRotate);
		controls.noPan = (noPan === undefined ? false : noPan);
		controls.rotateSpeed = 1.0;
		controls.zoomSpeed = 1.2;
		controls.panSpeed = 0.8;

		controls.noZoom = false;

		controls.dynamicDampingFactor = 0.3;
		controls.enabled = false;

		console.log(controls);

		// if the camera being set is of orthographic type, we never want the trackball control
		// doing the zooming
		if (camera instanceof THREE.OrthographicCamera) {
			controls.noZoom = true;
			controls.__zoomLevel = 1.0;
		}

		this.cameras[name] = [camera, controls];
		if (this.cameras.length === 1)
			this.makeActive(name);

		this.onchange = function() {};

		var o = this;
		controls.addEventListener( 'change', function() {
			o.onchange();
		});

	};

	CameraControl.prototype.reset = function() {
		for (var k in this.cameras) {
			this.cameras[k][1].reset();
		}
	};

	CameraControl.prototype.eachCamera = function(cb, type) {
		// iterate through each camera and call the cb, the cb should return
		// an array with two elements, first being the position, the second being
		// the target
		for(var k in this.cameras) {
			var cc = this.cameras[k];
			if (type === undefined)
				cb.apply(null, [cc[0], cc[1], k]);
			else if (cc[0] instanceof type)
				cb.apply(null, [cc[0], cc[1], k]);
		}
	};

	CameraControl.prototype.setPlanes = function(left, right, top, bottom) {
		// sets planes on all orhtographic cameras
		this.eachCamera(function(c, cnt) {
			c.left = left * cnt.__zoomLevel;
			c.right = right * cnt.__zoomLevel;
			c.top = top * cnt.__zoomLevel;
			c.bottom = bottom * cnt.__zoomLevel;

			c.updateProjectionMatrix();
		}, THREE.OrthographicCamera);
	};

	CameraControl.prototype.updateProjectionMatrix = function() {
		this.eachCamera(function(c) {
			c.updateProjectionMatrix();
		});
	};

	CameraControl.prototype.makeActive = function(name) {
		this.eachCamera(function(camera, controls) {
			controls.enabled = false;
		});

		this.activeControls = this.cameras[name][1];
		this.activeCamera = this.cameras[name][0];

		this.activeControls.enabled = true;
	};

	CameraControl.prototype.update = function() {
		// only update the active camera, and leave all cameras in their current states
		this.activeControls.update();
	};

	CameraControl.prototype.resize = function(w, h) {
		// Perspective cameras need their aspects changed
		this.eachCamera(function(camera, control) {
			camera.viewportWidth = w;
			camera.viewportHeight = h;

			camera.left = -w / 2 * control.__zoomLevel;
			camera.right = w / 2 * control.__zoomLevel;
			camera.top = h / 2 * control.__zoomLevel;
			camera.bottom = -h / 2 * control.__zoomLevel;
			camera.updateProjectionMatrix();

			control.handleResize();
		}, THREE.OrthographicCamera);

		this.eachCamera(function(camera, control) {
			camera.aspect = w / h;
			camera.updateProjectionMatrix();

			control.handleResize();
		}, THREE.PerspectiveCamera);
	};

	CameraControl.prototype.setFov = function(fov) {
		// Our FOV only applies to perspective cameras
		this.eachCamera(function(camera, control) {
			camera.fov = fov;
			camera.updateProjectionMatrix();
		}, THREE.PerspectiveCamera);
	};


	CameraControl.prototype.setNearFar = function(near, far) {
		for(var v in this.cameras) {
			this.cameras[v][0].near = near;
			this.cameras[v][0].far = far;

			this.cameras[v][0].updateProjectionMatrix();
		}
	};

	var getCameraControl = (function() {
		var cc = null;
		return function(container) {
			if (cc === null) {
				cc = new CameraControl(container || document);
			}
			return cc;
		};
	})();

	function XYZRenderer() {
		this.off = null;
		this.downBy = 1;
		this.textureHeight = 0;

		this.uniforms = {
			pointSize: {type: 'f', value: currentPointSize() },
			xyzScale: { type: 'v3', value: new THREE.Vector3(1, 1, 1) },
			zrange: { type: 'v2', value: new THREE.Vector2(0, 0) },
			offsets: { type: 'v3', value: new THREE.Vector3(0, 0, 0) },
			which: { type: 'v3', value: new THREE.Vector3(0, 0, 0) }
		};

		this.mat = new THREE.ShaderMaterial({
			blending: THREE.CustomBlending,
			blendSrc: THREE.OneFactor,
			blendDst: THREE.ZeroFactor,
			/*jshint multistr: true */
			vertexShader: '\
			uniform float pointSize; \n\
			uniform vec3 xyzScale; \n\
			uniform vec2 zrange; \n\
			uniform vec3 offsets; \n\
			uniform vec3 which; \n\
			varying vec3 xyz; \n\
			void main() { \n\
				vec3 fpos = ((position.xyz - offsets) * xyzScale).xzy * vec3(-1, 1, 1); \n\
				vec4 mvPosition = modelViewMatrix * vec4(fpos, 1.0); \n\
				gl_Position = projectionMatrix * mvPosition; \n\
				gl_PointSize = pointSize; \n\
				xyz = which * fpos; \n\
			}',
			fragmentShader:'\n\
			varying vec3 xyz; \n\
			float shift_right(float v, float amt) {\
				v = floor(v) + 0.5;\
				return floor(v / exp2(amt));\
			}\
			float shift_left(float v, float amt) {\
				return floor(v * exp2(amt) + 0.5);\
			}\
			\
			float mask_last(float v, float bits) {\
				return mod(v, shift_left(1.0, bits));\
			}\
			float extract_bits(float num, float from, float to) {\
				from = floor(from + 0.5);\
				to = floor(to + 0.5);\
				return mask_last(shift_right(num, from), to - from);\
			}\
			vec4 encode_float(float val) {\
				if (val == 0.0)\
					return vec4(0, 0, 0, 0);\
				float sign = val > 0.0 ? 0.0 : 1.0;\
				val = abs(val);\
				float exponent = floor(log2(val));\
				float biased_exponent = exponent + 127.0;\
				float fraction = ((val / exp2(exponent)) - 1.0) * 8388608.0;\
				\
				float t = biased_exponent / 2.0;\
				float last_bit_of_biased_exponent = fract(t) * 2.0;\
				float remaining_bits_of_biased_exponent = floor(t);\
				\
				float byte4 = extract_bits(fraction, 0.0, 8.0) / 255.0;\
				float byte3 = extract_bits(fraction, 8.0, 16.0) / 255.0;\
				float byte2 = (last_bit_of_biased_exponent * 128.0 + extract_bits(fraction, 16.0, 23.0)) / 255.0;\
				float byte1 = (sign * 128.0 + remaining_bits_of_biased_exponent) / 255.0;\
				return vec4(byte4, byte3, byte2, byte1);\
			}\
			void main() { \n\
				float s = xyz.x + xyz.y + xyz.z; \
				gl_FragColor = encode_float(s); }',
			uniforms: this.uniforms
		});
	}

	XYZRenderer.prototype.resize = function(width, height) {
		this.off = new THREE.WebGLRenderTarget(width/this.downBy, height/this.downBy, { 
			stencilBuffer: false,
			magFilter: THREE.NearestFilter,
			minFilter: THREE.NearestFilter
		});

		this.off.generateMipmaps = false;

		this.textureHeight = height / this.downBy;
		console.log('texture height:', this.textureHeight);
	};

	var decodeFloat = function(input) {
		var fa = new Float32Array(input.buffer);
		return fa[0];
	};

	XYZRenderer.prototype._debugRender = function(renderer, scene, camera, x, y, z) {
		var prev = scene.overrideMaterial;
		scene.overrideMaterial = this.mat;

		this.uniforms.which.value = new THREE.Vector3(x, y, z);
		renderer.render(scene, camera);

		scene.overrideMaterial = prev;
	};

	XYZRenderer.prototype.pick = function(renderer, scene, camera, x, y) {
		if (this.X === null ||
			this.Y === null ||
			this.Z === null)
			return;

		var o = this;

		o.uniforms.pointSize.value = 10.0; // draw points with super size bloat

		renderer.setClearColor("#000", 0);
		var gl = renderer.getContext();


		var rx = x / this.downBy,
			ry = y / this.downBy;

		var renderWith = function(x, y, z) {
			o.uniforms.which.value = new THREE.Vector3(x, y, z);
			renderer.render(scene, camera, o.off, true);

			var tx = rx, ty = o.textureHeight - ry;

			var pixelBuffer = new Uint8Array(4);
			gl.readPixels(tx, ty, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuffer);

			return pixelBuffer;
		};

		var ox = 0.0, oy = 0.0, oz = 0.0;

		var prev = scene.overrideMaterial;
		scene.overrideMaterial = this.mat;

		ox = decodeFloat(renderWith(1, 0, 0));
		oy = decodeFloat(renderWith(0, 1, 0));
		oz = decodeFloat(renderWith(0, 0, 1));

		scene.overrideMaterial = prev;


		return new THREE.Vector3(ox, oy, oz);
	};


	var getXYZRenderer = (function() {
		var xyz = null;
		return function() {
			if (xyz === null)
				xyz = new XYZRenderer();
			return xyz;
		};
	})();

	function PointCollector(domElement) {
		this.points = [];
		this.domElement = domElement || window;

		this.fromCamera = null;
		this.size = [0, 0];

		var o = this;
		THREE.ImageUtils.loadTexture("/assets/circle.png", undefined, function(map) {
			o.mat = new THREE.SpriteMaterial({
						map: map,
						color: 0xffffff,
						fog: false,
					});
		});

		this._sprites = [];
		this.orthoScene = new THREE.Scene();
		this.orthoCamera = new THREE.OrthographicCamera(-1, 1.0, 1.0, -1.0, 1, 10);
		this.orthoCamera.position.z = 10;
	}

	PointCollector.prototype._2dProj = function(p, proj) {
		proj = proj || (new THREE.Projector());
		var ndc = p.clone();
		proj.projectVector(ndc, this.fromCamera);

		var screen = new THREE.Vector2(this.size[0] * (ndc.x + 1) / 2, this.size[1] - this.size[1] * (ndc.y + 1) / 2);
		var ortho = new THREE.Vector3(ndc.x * this.size[0] / 2, ndc.y * this.size[1] / 2, 1.0);

		return [screen, ortho];
	};


	PointCollector.prototype.push = function(x, y, p, isNew) {
		var newPos = new THREE.Vector2(x, y);
		for (var i = 0; i < this.points.length ; i ++) {
			if (newPos.distanceTo(this.points[i].screenPos) < 16.0) {
				// the user clicked on one of the points
				var thisPoint = this.points[i];

				this.orthoScene.remove(this.points[i].sprite);
				this.points.splice(i, 1);

				$.event.trigger({
					type: 'plasio.mensuration.pointRemoved',
					point: thisPoint
				});

				needRefresh = true;
				return;
			}
		}

		if (p.x === 0.0 && p.y === 0.0 && p.z === 0.0)
			return; // didn't click on a point

		if (this.points.length === 0) // first point starts with id == 1.
			p.id = 1;
		else if (isNew) { // if a new id increment, or use the parents
			p.id = this.points[this.points.length - 1].id + 1;
		}
		else {
			p.id = this.points[this.points.length - 1].id;
		}


		// the user intends to add a new point
		p.sprite = null;
		p.screenPos = newPos;
		p.color = new THREE.Color();
		p.color.setHSL(Math.random(), 0.8, 0.8);

		this.points.push(p);

		$.event.trigger({
			type: 'plasio.mensuration.pointAdded',
			point: p
		});

		needRefresh = true;
	};

	PointCollector.prototype.clearPoints = function() {
		for (var i = 0 ; i < this.points.length ; i ++) {
			this.orthoScene.remove(this.points[i].sprite);
		}

		this.points = [];
	};

	PointCollector.prototype._updateSpritePositions = function() {
		var width = this.size[0];
		var height = this.size[1];

		var proj = new THREE.Projector();

		// http://stackoverflow.com/questions/10858599/how-to-determine-if-plane-is-in-three-js-camera-frustum
		//
		this.fromCamera.updateMatrix(); // make sure camera's local matrix is updated
		this.fromCamera.updateMatrixWorld(); // make sure camera's world matrix is updated
		this.fromCamera.matrixWorldInverse.getInverse( this.fromCamera.matrixWorld );

		var frustum = new THREE.Frustum();
		frustum.setFromMatrix( new THREE.Matrix4().multiplyMatrices(this.fromCamera.projectionMatrix, 
																	this.fromCamera.matrixWorldInverse ) );

		for (var i = 0, il = this.points.length ; i < il ; i ++) {
			var p = this.points[i];

			if (!p.sprite) {
				p.sprite = new THREE.Sprite(this.mat);
				p.sprite.scale.set(16, 16, 1);
				this.orthoScene.add(p.sprite);
			}

			var ps = this._2dProj(p, proj);
			var ndc = ps[1];
			p.sprite.position.set(ndc.x, ndc.y, ndc.z);
			p.screenPos = ps[0];

			p.sprite.visible = frustum.containsPoint(p);
		}
	};

	PointCollector.prototype.reset = function() {
		this.points = [];
	};

	var getPointCollector = (function() {
		var pc = null;

		return function() {
			if (pc === null)
				pc = new PointCollector(renderer.domElement);
			return pc;
		};
	})();

	PointCollector.prototype.update = function() {
		var $e = $(this.domElement);
		var width = $e.width(),
			height = $e.height();


		var ac = getCameraControl().activeCamera;

		if (this.fromCamera != ac ||
			width !== this.size[0] || height !== this.size[1]) {
			// needs to be revalidated
			this.size = [width, height];
			this.fromCamera = ac;

			this.orthoCamera.left = -width / 2;
			this.orthoCamera.right = width / 2;
			this.orthoCamera.top = height / 2;
			this.orthoCamera.bottom = -height / 2;

			this.orthoCamera.updateProjectionMatrix();
			this._updateSpritePositions();

			needRefresh = true;
		}
	};

	PointCollector.prototype.render = function(renderer) {
		this._updateSpritePositions();

		renderer.clearDepth();
		renderer.render(this.orthoScene, this.orthoCamera);
	};

	function ModelCache() {
		this.models = {};
		this.inprogress = {};
	}

	ModelCache.prototype.getModel = function(url, cb) {
		var o = this;
		if (this.models[url])
			return setTimeout(function() {
				var m = o.models[url];
				cb(m[0], m[1]);
			}, 0);

			if (this.inprogress[url]) {
				// this download is in progress right now, so we'd wait till its done and then invoke user's callback
				//
				return this.inprogress[url].push(cb);
			}
			
			// this URL is neither loaded nor has it been queued, queue it
			this.inprogress[url] = [cb];

			$.event.trigger({
				type: 'plasio.progress.start'
			});

			var loader = new THREE.BinaryLoader();
			loader.load(url, function(geometry, materials) {
				console.log('Done loading object');

				$.event.trigger({
					type: 'plasio.progress.end'
				});

				for (var i = 0 ; i < materials.length ; i ++) {
					materials[i].ambient = new THREE.Color(1, 1, 1);
					materials[i].color = new THREE.Color(1, 1, 1);
				}

				o.models[url] = [geometry, materials];

				setTimeout(function() {
					var cbs = o.inprogress[url];
					delete o.inprogress[url];

					for (var k in cbs) {
						cbs[k](geometry, materials);
					}
				}, 0);
			},
			undefined, undefined,
			function(e) {
				$.event.trigger({
					type: "plasio.progress.progress",
					percent: (100 * e.loaded / e.total)
				});
			});
	};

	var getModelCache = (function() {
		var cache = null;
		return function() {
			if (cache === null)
				cache = new ModelCache();
			return cache;
		};
	})();

	w.startRenderer = function(render_container, status_cb) {
		init(render_container);
		animate();

		if(status_cb) {
			var vendor =
				renderer.context.getParameter(renderer.context.VERSION) + ", Provider: " +
				renderer.context.getParameter(renderer.context.VENDOR);
			status_cb(vendor);
		}
	};

	w.rendererDOMElement = function() {
		return renderer.domElement;
	};

	w.enableMensuration = function() {
		if (!mensurationMode) {
			mensurationMode = true;
			controls.enabled = false;

			getMensurationControls().setVisible(true);
			needRefresh = true;
		}
	};

	w.disableMensuration = function() {
		if (mensurationMode) {
			mensurationMode = false;
			controls.enabled = true;

			getMensurationControls().setVisible(false);
			needRefresh = true;
		}
	};

	function removeBatcher(b) {
		// if the provided batcher is an array, remove all elements from the scene
		if( Object.prototype.toString.call(b) === '[object Array]' ) {
			for (var i in b) {
				b[i].removeFromScene(scene);
			}
		}
		else
			b.removeFromScene(scene);
	}

	function addBatcher(b) {
		// if the provided batcher is an array, add all elements to the scene
		if( Object.prototype.toString.call(b) === '[object Array]' ) {
			for (var i in b) {
				b[i].addToScene(scene);
			}
		}
		else
			b.addToScene(scene);
	}

	function determineBatcherProps(b) {
		if( Object.prototype.toString.call(b) !== '[object Array]' ) {
			return [
				b.mn, b.mx, b.cg, b.scale
			];
		}

		// the scale in all should be the same, so we don't touch it
		var mx = null, mn = null, cg = null;
		for(var i in b) {
			if (mx === null) mx = b[i].mx.clone();
			else mx.set(Math.max(mx.x, b[i].mx.x),
						Math.max(mx.y, b[i].mx.y),
						Math.max(mx.z, b[i].mx.z));

			if (mn === null) mn = b[i].mn.clone();
			else mn.set(Math.min(mn.x, b[i].mn.x),
						Math.min(mn.y, b[i].mn.y),
						Math.min(mn.z, b[i].mn.z));

			if (cg === null) cg = b[i].cg.clone();
			else mn.set((cg.x * i + b[i].cg.x) / (i+1),
						(cg.y * i + b[i].cg.y) / (i+1),
						(cg.z * i + b[i].cg.z) / (i+1));
		}

		return [mx, mn, cg, b[0].scale];
	}


	var oldBatcher = null; // the particle system which is already loaded
	var restorePoint = [];
	w.loadBatcher = function(batcher, resetCamera, overrideCG) {
		if (oldBatcher !== null)
			removeBatcher(oldBatcher);

		addBatcher(batcher);
		oldBatcher = batcher;

		var batcherProps = determineBatcherProps(batcher);
		var mn = batcherProps[0],
			mx = batcherProps[1],
			cg = overrideCG || batcherProps[2],
			scale = batcherProps[3];

		if (resetCamera === true) {
			setupView(mn, mx, cg, scale);
			restorePoint = [mn, mx, cg, scale];
		}

		// update some of the fields
		var zrange = new THREE.Vector2(mn.z, mx.z);

		var cgToUse = overrideCG || cg;

		// trigger signals for setting offsets
		$.event.trigger({
			type: 'plasio.offsetsChanged',
			offsets: cgToUse
		});

		// z-range
		$.event.trigger({
			type: 'plasio.zrangeChanged',
			zrange: zrange
		});

		// trigger a signal which will cause the intenisty range to update
		$.event.trigger({
			type: 'plasio.intensityClampChanged'
		});

		// change scale
		$.event.trigger({
			type: 'plasio.scaleChanged',
			scale: scale
		});
	};

	var setupView = function(mins, maxs, cg, scale) {
		getCameraControl().reset();

		// make sure the projection and camera is setup correctly to view the loaded data
		//
		var range = [
			(maxs.x - mins.x) * scale.x,
			(maxs.y - mins.y) * scale.y,
			(maxs.z - mins.z) * scale.z
		];

		var farPlaneDist = Math.max(range[0], range[1], range[2]);
		var limits = Math.ceil(Math.sqrt(2*farPlaneDist*farPlaneDist));


		getCameraControl().setNearFar(1.0, farPlaneDist * 4);

		console.log('setupView');
		var zero = new THREE.Vector3(0, 0, 0);
		getCameraControl().eachCamera(function(camera, controls, name) {
			if (name === 'top')
				camera.position.set(0, farPlaneDist / 2, 0);
			else
				camera.position.set(-range[0]/2, cg.z + range[2], -range[1]/2);

			camera.lookAt(zero);

			console.log('setup', camera.position);
		});

		getCameraControl().setPlanes(-limits/2, limits/2, limits/2, -limits/2);
	};

	var numberWithCommas = function(x) {
		return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
	};

	var needRefresh = false; // whenever a scene re-render is needed
	function init(render_container) {
		var container = $(render_container);
		var w = container.width(),
			h = container.height();

		// world
		scene = new THREE.Scene();

		// ambiently light our scale objects
		var l = new THREE.AmbientLight(0xffffff);
		scene.add(l);

		renderer = new THREE.WebGLRenderer( { antialias: false } );
		renderer.setSize(w, h);
		renderer.autoClear = false;

		// instantiate camera control instance with the container we'd like it to use
		getCameraControl(render_container);

		// setup cameras
		getCameraControl().addCamera("perspective", new THREE.PerspectiveCamera(60, w/h, 1, 10000));
		getCameraControl().addCamera("ortho", new THREE.OrthographicCamera(-w/2, w/2, h/2, -h/2, 1, 10000));
		getCameraControl().addCamera("top", new THREE.OrthographicCamera(-w/2, w/2, h/2, -h/2, 1, 100000));

		getCameraControl().onchange = function() {
			console.log('change!');
			needRefresh = true;
		};

		getCameraControl().makeActive("perspective");
		getCameraControl().resize(w, h);

		getXYZRenderer().resize(w, h);

		container.append( renderer.domElement );

		window.addEventListener( 'resize', onWindowResize, false );

		$("#pointCount").html("No Points");
		$("#stats").show();

		$(document).on("plasio.cameraFOVChanged", function() {
			camera.fov = currentFOV();
			camera.updateProjectionMatrix();
		});

		$(document).on("plasio.camera.perspective", function() {
			getCameraControl().makeActive("perspective");
		});

		$(document).on("plasio.camera.ortho", function() {
			getCameraControl().makeActive("ortho");
		});

		$(document).on("plasio.camera.topView", function() {
			getCameraControl().makeActive("top");
		});

		$(document).on("plasio.camera.reset", function() {
			// reset the perspective camera controls
			if (restorePoint.length > 0)
				setupView(restorePoint[0], restorePoint[1], restorePoint[2], restorePoint[3]);
		});

		$(document).on('plasio.renderer.needRefresh', function() {
			needRefresh = true;
		});

		$(document).on('plasio.mensuration.pointsReset', function() {
			getPointCollector().clearPoints();
			needRefresh = true;
		});

		$(document).on('plasio.mensuration.addPoint', function(d) {
			var point = getXYZRenderer().pick(renderer, scene, getCameraControl().activeCamera, d.x, d.y);
			getPointCollector().push(d.x, d.y, point, d.startNew);

			console.log('Point added:', d.x, d.y, ' -> ', point);
		});

		var scaleObjects = [];
		$(document).on('plasio.scalegeoms.place', function(d) {
			var placeWhere = getXYZRenderer().pick(renderer, scene, getCameraControl().activeCamera, d.x, d.y);
			if (placeWhere.x === 0.0 && placeWhere.y === 0.0 && placeWhere.z === 0.0)
				return;

			var scale = d.scale || 1.0;

			getModelCache().getModel(d.url, function(geometry, materials) {
				var m = new THREE.Mesh(geometry, new THREE.MeshFaceMaterial(materials));
				m.position.set(placeWhere.x, placeWhere.y, placeWhere.z);

				m.scale.set(scale, scale, scale);

				scaleObjects.push(m);
				scene.add(m);

				needRefresh = true;


				// FIXME: I am not sure how to counter the black building yet, so we just queue
				// renders for next 2 seconds
				var count = 0;
				var rerenderStuff = function() {
					setTimeout(function() {
						needRefresh = true;

						if (count < 10)
							rerenderStuff();
						count ++;
					}, 200);
				};

				rerenderStuff();
			});
		});

		$(document).on('plasio.scalegeoms.reset', function(d) {
			for (var i = 0, il = scaleObjects.length ; i < il ; i ++) {
				scene.remove(scaleObjects[i]);
			}
			scaleObjects = [];

			needRefresh = true;
		});

		$(document).on('plasio.scalegeoms.scale', function(d) {
			for (var i = 0, il = scaleObjects.length ; i < il ; i ++) {
				scaleObjects[i].scale.set(d.scale, d.scale, d.scale);
			}
		});
	}

	function onWindowResize() {
		var container = $("#container");

		var w =	container.width();
		var h = container.height();

		getCameraControl().resize(w, h);
		renderer.setSize(w, h);

		getXYZRenderer().resize(w, h);

		render();
	}

	w.doRenderResize = onWindowResize;

	function animate() {
		requestAnimationFrame(animate);

		getCameraControl().update();
		getPointCollector().update();

		if (needRefresh) {
			render();
			needRefresh = false;
		}
	}

	var renderCollectorLines = function(r, c) {
		var scene = new THREE.Scene();

		var points = getPointCollector().points;
		for (var i = 0 ; i < points.length - 1 ; i ++) {
			var p = points[i],
				n = points[i+1];

			if (p.id !== n.id)
				continue; // don't connect if they belong to different segments

			var g = new THREE.Geometry();
			g.vertices.push(p);
			g.vertices.push(n);

			var m = new THREE.LineBasicMaterial({
				color: p.color.getHex(),
				linewidth: 5,
				blending: THREE.NoBlending,
				depthTest: false,
				depthWrite: false
			});

			var l = new THREE.Line(g, m);
			scene.add(l);
		}

		r.render(scene, c);
	};


	function render() {
		renderer.clear();
		var camera = getCameraControl().activeCamera;
		renderer.render(scene, camera);

		// render collector lines
		renderCollectorLines(renderer, camera);
		getPointCollector().render(renderer);
	}

	function updateColorUniformsForSource(uniforms, source) {
		uniforms.rgb_f.value = 0.0;
		uniforms.class_f.value = 0.0;
		uniforms.map_f.value = 0.0;
		uniforms.imap_f.value = 0.0;

		switch(source) {
			case "rgb": uniforms.rgb_f.value = 1.0; break;
			case "classification": uniforms.class_f.value = 1.0; break;
			case "heightmap-color": uniforms.map_f.value = 1.0; break;
			case "heightmap-color-inv": uniforms.imap_f.value = 1.0; break;
		}
	}

	function updateIntensityUniformsForSource(uniforms, source) {
		uniforms.intensity_f.value = 0.0;
		uniforms.height_f.value = 0.0;
		uniforms.iheight_f.value = 0.0;

		switch(source) {
			case "intensity": uniforms.intensity_f.value = 1.0; break;
			case "heightmap": uniforms.height_f.value = 1.0; break;
			case "heightmap-inv": uniforms.iheight_f.value = 1.0; break;
		}
	}

	function updateIntensityClampingForBatcher(uniforms, batcher) {
		var range = currentIntensityClamp();
		var n, x;
		if( Object.prototype.toString.call(batcher) !== '[object Array]' ) {
			n = batcher.in_n;
			x = batcher.in_x;
		}
		else {
			n = 9999999999; x = -9999999999;
			for (var i in batcher) {
				n = Math.min(n, batcher[i].in_n);
				x = Math.max(x, batcher[i].in_x);
			}
		}

		var f = function(v) {
			var vf = v  / 100.0;
			return n + (x - n) * vf;
		};

		var lower = f(parseFloat(range[0]));
		var higher = f(parseFloat(range[1]));

		uniforms.clampLower.value = lower;
		uniforms.clampHigher.value = Math.max(higher, lower + 0.001);
	}


	function updateColorClamping(uniforms) {
		var range = currentColorClamp();
		uniforms.colorClampLower.value = range[0];
		uniforms.colorClampHigher.value = Math.max(range[1], range[0] + 0.001);

		console.log(uniforms.colorClampLower.value,
					uniforms.colorClampHigher.value);
	}

	var shaderMaterial = null;
	function getMaterial(vs, fs) {
		if (shaderMaterial !== null)
			return shaderMaterial;

		var attributes = {
			color: { type: 'c', value: null },
			intensity: { type: 'f', value: null },
			classification: { type: 'f', value: null }
		};

		var iblend = currentIntensityClamp();
		var cclamp = currentColorClamp();

		var uniforms = {
			pointSize: { type: 'f', value: currentPointSize() },
			intensityBlend: { type: 'f', value: currentIntensityBlend() / 100.0 },
			maxColorComponent: { type: 'f', value: 1.0 },

			// colors
			rgb_f: { type: 'f', value: 1.0 },
			class_f: { type: 'f', value: 0.0 },
			map_f: { type: 'f', value: 0.0 },
			imap_f: { type: 'f', value: 0.0 },

			// intensity
			intensity_f: { type: 'f', value: 0.0 },
			height_f: { type: 'f', value: 0.0 },
			iheight_f: { type: 'f', value: 0.0 },

			xyzScale: { type: 'v3', value: new THREE.Vector3(1, 1, 1) },

			clampLower: { type: 'f', value: iblend[0] },
			clampHigher: { type: 'f', value: iblend[1] },

			colorClampLower: { type: 'f', value: cclamp[0] },
			colorClampHigher: { type: 'f', value: cclamp[1] },

			zrange: { type: 'v2', value: new THREE.Vector2(0, 0) },
			offsets: { type: 'v3', value: new THREE.Vector3(0, 0, 0) },
			map: { type: 't', value: THREE.ImageUtils.loadTexture(currentColorMap())}
		};

		updateColorUniformsForSource(uniforms, currentColorSource());
		updateIntensityUniformsForSource(uniforms, currentIntensitySource());
		if (oldBatcher !== null)
			updateIntensityClampingForBatcher(uniforms, oldBatcher);

		updateColorClamping(uniforms);

		shaderMaterial = new THREE.ShaderMaterial({
			vertexShader: vs,
			fragmentShader: fs,
			attriutes: attributes,
			uniforms: uniforms
		});

		// attach handlers for notifications
		$(document).on("plasio.colormapChanged", function() {
			var colormap = currentColorMap();

			console.log('Colormap changed to:', colormap);

			THREE.ImageUtils.loadTexture(colormap, undefined, function(tex) {
				uniforms.map.value = tex;
				uniforms.map.needsUpdate = true;
			});
		});

		$(document).on("plasio.colorsourceChanged", function() {
			updateColorUniformsForSource(uniforms, currentColorSource());
		});

		$(document).on("plasio.intensitysourceChanged", function() {
			updateIntensityUniformsForSource(uniforms, currentIntensitySource());
		});

		$(document).on("plasio.intensityClampChanged", function() {
			if (oldBatcher !== null)
				updateIntensityClampingForBatcher(uniforms, oldBatcher);
		});

		$(document).on("plasio.colorClampChanged", function() {
			updateColorClamping(uniforms);
		});

		$(document).on("plasio.intensityBlendChanged", function() {
			var f = currentIntensityBlend();
			uniforms.intensityBlend.value = f / 100.0;

		});

		$(document).on("plasio.pointSizeChanged", function() {
			var f = currentPointSize();
			getXYZRenderer().uniforms.pointSize.value = f;
			uniforms.pointSize.value = f;
		});

		$(document).on("plasio.maxColorComponent", function(e) {
			uniforms.maxColorComponent.value = Math.max(0.0001, e.maxColorComponent);
		});

		$(document).on("plasio.offsetsChanged", function(e) {
			getXYZRenderer().uniforms.offsets.value = e.offsets;
			uniforms.offsets.value = e.offsets;
		});

		$(document).on("plasio.zrangeChanged", function(e) {
			getXYZRenderer().uniforms.zrange.value = e.zrange;
			uniforms.zrange.value = e.zrange;
		});

		$(document).on("plasio.scaleChanged", function(e) {
			getXYZRenderer().uniforms.xyzScale.value = e.scale;
			uniforms.xyzScale.value = e.scale;
		});


		shaderMaterial.uniforms = uniforms;
		shaderMaterial.attributes = attributes;

		return shaderMaterial;
	}

	// An object that manages a bunch of particle systems
	var ParticleSystemBatcher = function(vs, fs) {
		this.material = getMaterial(vs, fs);

		this.pss = []; // particle systems in use

		this.mx = null;
		this.mn = null;
		this.cg = null;
		this.cn = null;
		this.cx = null;
		this.in_x = null;
		this.in_y = null;
		this.pointsSoFar = 0;
	};

	ParticleSystemBatcher.prototype.push = function(lasBuffer) {
		var geometry = new THREE.BufferGeometry();
		var count = lasBuffer.pointsCount;

		geometry.addAttribute( 'position', Float32Array, count, 3 );
		geometry.addAttribute( 'color', Float32Array, count, 3 );
		geometry.addAttribute( 'intensity', Float32Array, count, 1 );
		geometry.addAttribute( 'classification', Float32Array, count, 1 );

		var positions = geometry.attributes.position.array;
		var colors = geometry.attributes.color.array;
		var intensity = geometry.attributes.intensity.array;
		var classification = geometry.attributes.classification.array;

		// the running average of cg
		var cg = null;
		var mx = null;
		var mn = null;
		var cn = null, cx = null;
		var in_x = null, in_n = null;

		for ( var i = 0; i < count; i ++) {
			var p = lasBuffer.getPoint(i);

			var x = p.position[0] * lasBuffer.scale[0] + lasBuffer.offset[0];
			var y = p.position[1] * lasBuffer.scale[1] + lasBuffer.offset[1];
			var z = p.position[2] * lasBuffer.scale[2] + lasBuffer.offset[2];

			if (cg === null)
				cg = new THREE.Vector3(x, y, z);
			else
				cg.set((cg.x * i + x) / (i+1),
					   (cg.y * i + y) / (i+1),
					   (cg.z * i + z) / (i+1));

			if (mx === null)
				mx = new THREE.Vector3(x, y, z);
			else
				mx.set(Math.max(mx.x, x),
					   Math.max(mx.y, y),
					   Math.max(mx.z, z));

			if (mn === null)
				mn = new THREE.Vector3(x, y, z);
			else
				mn.set(Math.min(mn.x, x),
					   Math.min(mn.y, y),
					   Math.min(mn.z, z));

			// get the color component out
			var r, g, b;
			if (p.color) {
				r = p.color[0] / 255.0;
				g = p.color[1] / 255.0;
				b = p.color[2] / 255.0;
			}
			else {
				r = g = b = 0;
			}

			if (cn === null) {
				cn = new THREE.Color();
				cn.r = r; cn.g = g; cn.b = b;
			}
			else {
				cn.r = Math.min(cn.r, r);
				cn.g = Math.min(cn.g, g);
				cn.b = Math.min(cn.b, b);
			}

			if (cx === null) {
				cx = new THREE.Color();
				cx.r = r; cx.g = g; cx.b = b;
			}
			else {
				cx.r = Math.max(cx.r, r);
				cx.g = Math.max(cx.g, g);
				cx.b = Math.max(cx.b, b);
			}

			in_n = (in_n === null)? p.intensity : Math.min(in_n, p.intensity);
			in_x = (in_x === null)? p.intensity : Math.max(in_x, p.intensity);

			positions[ 3*i ]     = x;
			positions[ 3*i + 1 ] = y;
			positions[ 3*i + 2 ] = z;

			colors[ 3*i ] = r;
			colors[ 3*i + 1 ] = g;
			colors[ 3*i + 2 ] = b;

			intensity[i] = p.intensity;
			classification[i] = p.classification;
		}

		if (this.cg === null) this.cg = cg;
		else this.cg.set(
			(this.cg.x * this.pointsSoFar + cg.x * count) / (this.pointsSoFar + count),
			(this.cg.y * this.pointsSoFar + cg.y * count) / (this.pointsSoFar + count),
			(this.cg.z * this.pointsSoFar + cg.z * count) / (this.pointsSoFar + count));

		if (this.mx === null) this.mx = mx;
		else this.mx.set(
			Math.max(mx.x, this.mx.x),
			Math.max(mx.y, this.mx.y),
			Math.max(mx.z, this.mx.z));

		if (this.mn === null) this.mn = mn;
		else this.mn.set(
			Math.min(mn.x, this.mn.x),
			Math.min(mn.y, this.mn.y),
			Math.min(mn.z, this.mn.z));

		if (this.cn === null) this.cn = cn;
		else {
			this.cn.r = Math.min(this.cn.r, cn.r);
			this.cn.g = Math.min(this.cn.g, cn.g);
			this.cn.b = Math.min(this.cn.b, cn.b);
		}

		if (this.cx === null) this.cx = cx;
		else {
			this.cx.r = Math.max(this.cx.r, cx.r);
			this.cx.g = Math.max(this.cx.g, cx.g);
			this.cx.b = Math.max(this.cx.b, cx.b);
		}

		this.in_n = (this.in_n === null)? in_n : Math.min(in_n, this.in_y);
		this.in_x = (this.in_x === null)? in_x : Math.max(in_x, this.in_x);

		var ps = new THREE.ParticleSystem(geometry, this.material);
		this.pss.push(ps);

		this.pointsSoFar += count;
	};


	ParticleSystemBatcher.prototype.addToScene = function(scene) {
		for (var i = 0, il = this.pss.length ; i < il ; i ++) {
			scene.add(this.pss[i]);
		}
	};

	ParticleSystemBatcher.prototype.removeFromScene = function(scene) {
		for (var i = 0, il = this.pss.length ; i < il ; i ++) {
			scene.remove(this.pss[i]);
		}
	};

	w.ParticleSystemBatcher = ParticleSystemBatcher;
})(module.exports);
