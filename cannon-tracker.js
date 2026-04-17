const MODULE_ID = "fvtt-cannon-manager";
const MAX_CANNONS = 30;
const DEFAULT_CANNON_COUNT = 3;

function defaultProfiles() {
  return [
    {
      id: "standard-shot",
      name: "Standard Shot",
      attackFormula: "1d20+5",
      damageFormula: "4d10+5",
      ballCost: 1,
      powderCost: 1
    }
  ];
}

function defaultProfileId() {
  return defaultProfiles()[0].id;
}

function defaultCannons(cannonCount = DEFAULT_CANNON_COUNT, profileId = defaultProfileId()) {
  return Array.from({ length: Math.min(MAX_CANNONS, Math.max(0, cannonCount)) }, (_, index) => ({
    id: index + 1,
    name: `Cannon ${index + 1}`,
    enabled: true,
    loaded: false,
    profileId
  }));
}

function normalizeProfiles(data) {
  const fallback = defaultProfiles();
  const source = Array.isArray(data) && data.length ? data : fallback;
  const taken = new Set();

  const normalized = source
    .map((entry, index) => {
      const candidateId =
        typeof entry?.id === "string" && entry.id.trim() ? entry.id.trim() : `profile-${index + 1}`;
      const id = taken.has(candidateId) ? `${candidateId}-${index + 1}` : candidateId;
      taken.add(id);

      return {
        id,
        name: typeof entry?.name === "string" && entry.name.trim() ? entry.name.trim() : `Profile ${index + 1}`,
        attackFormula:
          typeof entry?.attackFormula === "string" && entry.attackFormula.trim()
            ? entry.attackFormula.trim()
            : "1d20+5",
        damageFormula:
          typeof entry?.damageFormula === "string" && entry.damageFormula.trim()
            ? entry.damageFormula.trim()
            : "4d10+5",
        ballCost: normalizeNumber(entry?.ballCost, 1),
        powderCost: normalizeNumber(entry?.powderCost, 1)
      };
    })
    .slice(0, MAX_CANNONS);

  return normalized.length ? normalized : fallback;
}

function normalizeCannons(data, profiles) {
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const firstProfileId = profiles[0].id;

  const source = Array.isArray(data) && data.length ? data : defaultCannons(DEFAULT_CANNON_COUNT, firstProfileId);
  const normalized = source
    .slice(0, MAX_CANNONS)
    .map((entry, index) => ({
      id: normalizeNumber(entry?.id, index + 1) || index + 1,
      name: typeof entry?.name === "string" && entry.name.trim() ? entry.name.trim() : `Cannon ${index + 1}`,
      enabled: entry?.enabled === undefined ? true : Boolean(entry.enabled),
      loaded: Boolean(entry?.loaded),
      profileId: profileIds.has(entry?.profileId) ? entry.profileId : firstProfileId
    }));

  return normalized.length ? normalized : defaultCannons(DEFAULT_CANNON_COUNT, firstProfileId);
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = Math.floor(numeric);
  return normalized < 0 ? 0 : normalized;
}

function normalizeState(state) {
  const profiles = normalizeProfiles(state?.profiles);
  return {
    profiles,
    cannons: normalizeCannons(state?.cannons, profiles),
    cannonBalls: normalizeNumber(state?.cannonBalls, 100),
    powderCharges: normalizeNumber(state?.powderCharges, 100)
  };
}

function getVehicleActors() {
  return game.actors.filter((actor) => actor?.type === "vehicle" && actor.isOwner);
}

function getActorById(actorId) {
  return actorId ? game.actors.get(actorId) ?? null : null;
}

function getNumericSetting(key, fallback = 0) {
  return normalizeNumber(game.settings.get(MODULE_ID, key), fallback);
}

function getWorldState() {
  return normalizeState({
    cannons: game.settings.get(MODULE_ID, "cannonData"),
    profiles: game.settings.get(MODULE_ID, "cannonProfiles"),
    cannonBalls: getNumericSetting("cannonBalls", 100),
    powderCharges: getNumericSetting("powderCharges", 100)
  });
}

async function saveWorldState(state) {
  const normalized = normalizeState(state);
  await game.settings.set(MODULE_ID, "cannonData", normalized.cannons);
  await game.settings.set(MODULE_ID, "cannonProfiles", normalized.profiles);
  await game.settings.set(MODULE_ID, "cannonBalls", normalized.cannonBalls);
  await game.settings.set(MODULE_ID, "powderCharges", normalized.powderCharges);
}

function getActorState(actor) {
  const flagState = actor?.getFlag(MODULE_ID, "state") ?? {};
  return normalizeState(flagState);
}

async function saveActorState(actor, state) {
  await actor.setFlag(MODULE_ID, "state", normalizeState(state));
}

function getSelectedVehicleActor() {
  const selectedId = game.settings.get(MODULE_ID, "activeVehicleActorId");
  return getActorById(selectedId);
}

async function setSelectedVehicleActor(actorId) {
  const actor = getActorById(actorId);
  const validId = actor?.type === "vehicle" ? actor.id : "";
  await game.settings.set(MODULE_ID, "activeVehicleActorId", validId);
}

function cloneState(state) {
  return {
    profiles: state.profiles.map((profile) => ({ ...profile })),
    cannons: state.cannons.map((cannon) => ({ ...cannon })),
    cannonBalls: state.cannonBalls,
    powderCharges: state.powderCharges
  };
}

function nextProfileId(profiles) {
  const used = new Set(profiles.map((profile) => profile.id));
  let index = 1;
  while (used.has(`profile-${index}`)) index += 1;
  return `profile-${index}`;
}

function nextCannonId(cannons) {
  return cannons.reduce((max, cannon) => Math.max(max, cannon.id), 0) + 1;
}

Hooks.once("init", () => {
  loadTemplates([`modules/${MODULE_ID}/templates/cannon-hud.hbs`]);

  game.settings.register(MODULE_ID, "cannonData", {
    scope: "world",
    config: false,
    type: Array,
    default: defaultCannons()
  });

  game.settings.register(MODULE_ID, "cannonProfiles", {
    scope: "world",
    config: false,
    type: Array,
    default: defaultProfiles()
  });

  game.settings.register(MODULE_ID, "cannonBalls", {
    name: "Cannon Balls",
    hint: "Available cannon balls for reloading.",
    scope: "world",
    config: false,
    type: Number,
    default: 100,
    onChange: () => cannonApp?.render(false)
  });

  game.settings.register(MODULE_ID, "powderCharges", {
    name: "Powder Charges",
    hint: "Available powder charges for reloading.",
    scope: "world",
    config: false,
    type: Number,
    default: 100,
    onChange: () => cannonApp?.render(false)
  });

  game.settings.register(MODULE_ID, "activeVehicleActorId", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
});

class CannonTrackerApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "cannon-tracker-hud",
      title: "Cannon Tracker",
      template: `modules/${MODULE_ID}/templates/cannon-hud.hbs`,
      width: 1080,
      height: "auto",
      popOut: true,
      resizable: true
    });
  }

  _getContext() {
    const vehicleActor = getSelectedVehicleActor();
    const source = vehicleActor ? "vehicle" : "world";
    const state = vehicleActor ? getActorState(vehicleActor) : getWorldState();
    return { source, vehicleActor, state };
  }

  async _saveContext(context, state) {
    if (context.source === "vehicle" && context.vehicleActor) {
      await saveActorState(context.vehicleActor, state);
      return;
    }
    await saveWorldState(state);
  }

  getData() {
    const context = this._getContext();
    const vehicles = getVehicleActors().map((actor) => ({
      id: actor.id,
      name: actor.name,
      selected: actor.id === context.vehicleActor?.id
    }));

    return {
      source: context.source,
      sourceLabel: context.vehicleActor ? context.vehicleActor.name : "World Storage (unlinked)",
      vehicles,
      hasVehicles: vehicles.length > 0,
      cannonBalls: context.state.cannonBalls,
      powderCharges: context.state.powderCharges,
      profiles: context.state.profiles,
      cannons: context.state.cannons.map((cannon) => ({
        ...cannon,
        profileName: context.state.profiles.find((profile) => profile.id === cannon.profileId)?.name ?? "Unassigned",
        profileOptions: context.state.profiles.map((profile) => ({
          id: profile.id,
          name: profile.name,
          selected: profile.id === cannon.profileId
        }))
      })),
      loadedCount: context.state.cannons.filter((cannon) => cannon.enabled && cannon.loaded).length,
      enabledCount: context.state.cannons.filter((cannon) => cannon.enabled).length,
      canAddCannon: context.state.cannons.length < MAX_CANNONS
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find("#vehicle-actor-select").on("change", async (event) => {
      await setSelectedVehicleActor(event.currentTarget.value);
      this.render(false);
    });

    html.find("#cannon-balls-input").on("change", async (event) => {
      const context = this._getContext();
      const state = cloneState(context.state);
      state.cannonBalls = normalizeNumber(event.currentTarget.value, 0);
      await this._saveContext(context, state);
      this.render(false);
    });

    html.find("#powder-charges-input").on("change", async (event) => {
      const context = this._getContext();
      const state = cloneState(context.state);
      state.powderCharges = normalizeNumber(event.currentTarget.value, 0);
      await this._saveContext(context, state);
      this.render(false);
    });

    html.find(".cannon-name-input").on("change", async (event) => {
      const cannonId = Number(event.currentTarget.dataset.cannonId);
      const name = String(event.currentTarget.value || "").trim();
      await this._renameCannon(cannonId, name);
    });

    html.find(".cannon-profile-select").on("change", async (event) => {
      const cannonId = Number(event.currentTarget.dataset.cannonId);
      await this._setCannonProfile(cannonId, event.currentTarget.value);
    });

    html.find(".cannon-reload").on("click", async (event) => {
      await this._reloadCannon(Number(event.currentTarget.dataset.cannonId));
    });

    html.find(".cannon-fire").on("click", async (event) => {
      await this._fireCannon(Number(event.currentTarget.dataset.cannonId));
    });

    html.find(".cannon-toggle-enabled").on("click", async (event) => {
      await this._toggleCannonEnabled(Number(event.currentTarget.dataset.cannonId));
    });

    html.find("#cannon-reload-all").on("click", async () => {
      await this._reloadAll();
    });

    html.find("#cannon-add").on("click", async () => {
      await this._addCannon();
    });

    html.find("#profile-add").on("click", async () => {
      await this._addProfile();
    });

    html.find(".profile-remove").on("click", async (event) => {
      await this._removeProfile(event.currentTarget.dataset.profileId);
    });

    html.find(".profile-input").on("change", async (event) => {
      const profileId = event.currentTarget.dataset.profileId;
      const field = event.currentTarget.dataset.field;
      const value = event.currentTarget.value;
      await this._updateProfile(profileId, field, value);
    });
  }

  async _toggleCannonEnabled(cannonId) {
    const context = this._getContext();
    const state = cloneState(context.state);
    const cannon = state.cannons.find((entry) => entry.id === cannonId);
    if (!cannon) return;

    cannon.enabled = !cannon.enabled;
    await this._saveContext(context, state);
    this.render(false);
  }

  async _renameCannon(cannonId, name) {
    const context = this._getContext();
    const state = cloneState(context.state);
    const cannon = state.cannons.find((entry) => entry.id === cannonId);
    if (!cannon) return;

    cannon.name = name || cannon.name;
    await this._saveContext(context, state);
    this.render(false);
  }

  async _setCannonProfile(cannonId, profileId) {
    const context = this._getContext();
    const state = cloneState(context.state);
    const cannon = state.cannons.find((entry) => entry.id === cannonId);
    const profile = state.profiles.find((entry) => entry.id === profileId);
    if (!cannon || !profile) return;

    cannon.profileId = profile.id;
    await this._saveContext(context, state);
    this.render(false);
  }

  _findProfile(state, cannon) {
    return state.profiles.find((profile) => profile.id === cannon.profileId) ?? state.profiles[0];
  }

  _hasAmmo(state, ballCost, powderCost) {
    if (state.cannonBalls < ballCost || state.powderCharges < powderCost) {
      ui.notifications.warn(
        `Not enough ammo (${ballCost} balls, ${powderCost} powder required). Available: ` +
          `${state.cannonBalls} balls, ${state.powderCharges} powder.`
      );
      return false;
    }
    return true;
  }

  _consumeAmmo(state, ballCost, powderCost) {
    state.cannonBalls = normalizeNumber(state.cannonBalls - ballCost, 0);
    state.powderCharges = normalizeNumber(state.powderCharges - powderCost, 0);
  }

  async _reloadCannon(cannonId) {
    const context = this._getContext();
    const state = cloneState(context.state);
    const cannon = state.cannons.find((entry) => entry.id === cannonId);
    if (!cannon || !cannon.enabled) {
      ui.notifications.warn(`Cannon ${cannonId} is disabled.`);
      return;
    }

    if (cannon.loaded) {
      ui.notifications.info(`Cannon ${cannonId} is already loaded.`);
      return;
    }

    const profile = this._findProfile(state, cannon);
    if (!this._hasAmmo(state, profile.ballCost, profile.powderCost)) return;

    this._consumeAmmo(state, profile.ballCost, profile.powderCost);
    cannon.loaded = true;
    await this._saveContext(context, state);

    ui.notifications.info(`Reloaded ${cannon.name}.`);
    this.render(false);
  }

  async _fireCannon(cannonId) {
    const context = this._getContext();
    const state = cloneState(context.state);
    const cannon = state.cannons.find((entry) => entry.id === cannonId);
    if (!cannon || !cannon.enabled) {
      ui.notifications.warn(`Cannon ${cannonId} is disabled.`);
      return;
    }

    if (!cannon.loaded) {
      ui.notifications.warn(`${cannon.name} is not loaded.`);
      return;
    }

    cannon.loaded = false;
    await this._saveContext(context, state);
    this.render(false);
    await this._postAttackRoll(cannon, this._findProfile(state, cannon), context.vehicleActor);
  }

  async _reloadAll() {
    const context = this._getContext();
    const state = cloneState(context.state);
    const toReload = state.cannons.filter((cannon) => cannon.enabled && !cannon.loaded);
    if (!toReload.length) {
      ui.notifications.info("All enabled cannons are already loaded.");
      return;
    }

    const totalBallCost = toReload.reduce((sum, cannon) => sum + this._findProfile(state, cannon).ballCost, 0);
    const totalPowderCost = toReload.reduce((sum, cannon) => sum + this._findProfile(state, cannon).powderCost, 0);

    if (!this._hasAmmo(state, totalBallCost, totalPowderCost)) return;

    this._consumeAmmo(state, totalBallCost, totalPowderCost);
    toReload.forEach((cannon) => {
      cannon.loaded = true;
    });

    await this._saveContext(context, state);
    ui.notifications.info(`Reloaded ${toReload.length} cannon(s).`);
    this.render(false);
  }

  async _addCannon() {
    const context = this._getContext();
    const state = cloneState(context.state);
    if (state.cannons.length >= MAX_CANNONS) {
      ui.notifications.warn(`Maximum of ${MAX_CANNONS} cannons reached.`);
      return;
    }

    const nextId = nextCannonId(state.cannons);
    state.cannons.push({
      id: nextId,
      name: `Cannon ${nextId}`,
      enabled: true,
      loaded: false,
      profileId: state.profiles[0].id
    });

    await this._saveContext(context, state);
    this.render(false);
  }

  async _addProfile() {
    const context = this._getContext();
    const state = cloneState(context.state);
    const newProfileId = nextProfileId(state.profiles);
    const profileLabel = newProfileId.replace("profile-", "");

    state.profiles.push({
      id: newProfileId,
      name: `Profile ${profileLabel}`,
      attackFormula: "1d20+5",
      damageFormula: "4d10+5",
      ballCost: 1,
      powderCost: 1
    });

    await this._saveContext(context, state);
    this.render(false);
  }

  async _removeProfile(profileId) {
    const context = this._getContext();
    const state = cloneState(context.state);
    if (state.profiles.length <= 1) {
      ui.notifications.warn("At least one profile is required.");
      return;
    }

    const exists = state.profiles.some((profile) => profile.id === profileId);
    if (!exists) return;

    state.profiles = state.profiles.filter((profile) => profile.id !== profileId);
    const fallbackProfileId = state.profiles[0].id;

    state.cannons.forEach((cannon) => {
      if (cannon.profileId === profileId) cannon.profileId = fallbackProfileId;
    });

    await this._saveContext(context, state);
    this.render(false);
  }

  async _updateProfile(profileId, field, rawValue) {
    const context = this._getContext();
    const state = cloneState(context.state);
    const profile = state.profiles.find((entry) => entry.id === profileId);
    if (!profile) return;

    if (["ballCost", "powderCost"].includes(field)) {
      profile[field] = normalizeNumber(rawValue, 0);
    } else if (["name", "attackFormula", "damageFormula"].includes(field)) {
      profile[field] = String(rawValue || "").trim() || profile[field];
    }

    await this._saveContext(context, state);
    this.render(false);
  }

  async _postAttackRoll(cannon, profile, vehicleActor) {
    if (!Roll.validate(profile.attackFormula) || !Roll.validate(profile.damageFormula)) {
      ui.notifications.error(`Invalid formula in profile: ${profile.name}`);
      return;
    }

    const attackRoll = await new Roll(profile.attackFormula).evaluate();
    const damageRoll = await new Roll(profile.damageFormula).evaluate();

    const actorLabel = vehicleActor ? ` (${foundry.utils.escapeHTML(vehicleActor.name)})` : "";
    const content = `
      <div class="cannon-roll-chat">
        <h3>🔥 ${foundry.utils.escapeHTML(cannon.name)} fired${actorLabel}</h3>
        <p><strong>Profile:</strong> ${foundry.utils.escapeHTML(profile.name)}</p>
        <p><strong>Attack:</strong> ${attackRoll.total} <span class="formula">(${attackRoll.formula})</span></p>
        <p><strong>Damage:</strong> ${damageRoll.total} <span class="formula">(${damageRoll.formula})</span></p>
      </div>
    `;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ alias: "Cannon Tracker" }),
      content,
      rolls: [attackRoll, damageRoll]
    });
  }
}

let cannonApp;

Hooks.once("ready", async () => {
  await saveWorldState(getWorldState());

  const selected = getSelectedVehicleActor();
  if (selected?.type !== "vehicle") {
    await setSelectedVehicleActor("");
  }
});

async function openCannonTracker({ actorId = "" } = {}) {
  if (actorId) {
    await setSelectedVehicleActor(actorId);
  }

  cannonApp ??= new CannonTrackerApp();
  cannonApp.render(true);
}

Hooks.on("getSceneControlButtons", (controls) => {
  const tokenControls = controls.find((control) => control.name === "token");
  if (!tokenControls) return;

  tokenControls.tools.push({
    name: "open-cannon-tracker",
    title: "Open Cannon Tracker",
    icon: "fas fa-bomb",
    button: true,
    onClick: () => openCannonTracker()
  });
});

Hooks.on("getActorSheetHeaderButtons", (app, buttons) => {
  const actor = app?.actor;
  if (!actor || actor.type !== "vehicle") return;

  buttons.unshift({
    label: "Cannons",
    class: "open-cannon-tracker",
    icon: "fas fa-bomb",
    onclick: () => openCannonTracker({ actorId: actor.id })
  });
});
