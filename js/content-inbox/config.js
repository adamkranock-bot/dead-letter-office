(function () {
	dlo.cfg.deleted = {
		add: function (id) {
			if (dlo.cfg.data.deleted.indexOf(id) >= 0) return;
			dlo.cfg.data.deleted.push(id);
			dlo.proxy(['dlo_cfg_deleted', 'add'], [id]);
		}
		, remove: function (id) {
			dlo.proxy(['dlo_cfg_deleted', 'remove'], [id]);
			var index;
			while ((index = dlo.cfg.data.deleted.indexOf(id)) >= 0) {
				dlo.cfg.data.deleted.splice(index, 1);
			}
		}
		, contains: function (id) {
			return (dlo.cfg.data.deleted.indexOf(id) >= 0);
		}
	};
	dlo.cfg.saved = {
		add: function (id) {
			if (dlo.cfg.data.saved.indexOf(id) >= 0) return;
			dlo.cfg.data.saved.push(id);
			dlo.proxy(['dlo_cfg_saved', 'add'], [id]);
		}
		, remove: function (id) {
			dlo.proxy(['dlo_cfg_saved', 'remove'], [id]);
			var index;
			while ((index = dlo.cfg.data.saved.indexOf(id)) >= 0) {
				dlo.cfg.data.saved.splice(index, 1);
			}
		}
		, contains: function (id) {
			return (dlo.cfg.data.saved.indexOf(id) >= 0);
		}
	};
	dlo.cfg.set = function (prop, value) {
		dlo.cfg.data[prop] = value;
		dlo.proxy(['dlo', 'cfg_set'], [prop, value]);
	};
})();