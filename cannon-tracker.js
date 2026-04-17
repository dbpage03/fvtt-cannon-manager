const MODULE_ID = "cannon-tracker";
const MAX_CANNONS = 30;

function defaultCannons() {
  return Array.from({ length: MAX_CANNONS }, (_, index) => ({
    id: index + 1,
    name: `Cannon ${index + 1}`,
    enabled: true,
    loaded: false
  }));
}

function normalizeCannonData(data) {
  const defaults = defaultCannons();
  if (!Array.isArray(data)) return defaults;

  return defaults.map((cannon, index) => {
    const existing = data[index] ?? {};
    return {
      id: cannon.id,
      name: typeof existing.name === "string" && existing.name.trim() ? existing.name : cannon.name,
      enabled: existing.enabled === undefined ? cannon.enabled : Boolean(existing.enabled),
      loaded: Boolean(existing.loaded)
    };
  });
}

function getCannonData() {
  const cannonData = game.settings.get(MODULE_ID, "cannonData");
  return normalizeCannonData(cannonData);
}

async function saveCannonData(data) {
  await game.settings.set(MODULE_ID, "cannonData", normalizeCannonData(data));
}

function getNumericSetting(key) {
  const value = Number(game.settings.get(MODULE_ID, key));
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

async function setNumericSetting(key, value) {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  await game.settings.set(MODULE_ID, key, normalized);
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "cannonData", {
    scope: "world",
    config: false,
    type: Array,
    default: defaultCannons()
  });

  game.settings.register(MODULE_ID, "cannonBalls", {
    name: "Cannon Balls",
    hint: "Available cannon balls for reloading.",
    scope: "world",
    config: true,
    type: Number,
    default: 100,
    onChange: () => cannonApp?.render(false)
  });

  game.settings.register(MODULE_ID, "powderCharges", {
    name: "Powder Charges",
    hint: "Available powder charges for reloading.",
    scope: "world",
    config: true,
    type: Number,
    default: 100,
    onChange: () => cannonApp?.render(false)
  });

  game.settings.register(MODULE_ID, "attackFormula", {
    name: "Attack Roll Formula",
    hint: "Dice formula used for each cannon attack roll.",
    scope: "world",
    config: true,
    type: String,
    default: "1d20+5"
  });

  game.settings.register(MODULE_ID, "damageFormula", {
    name: "Damage Formula",
    hint: "Dice formula displayed as cannon damage.",
    scope: "world",
    config: true,
    type: String,
    default: "4d10+5"
  });
});

class CannonTrackerApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "cannon-tracker-hud",
      title: "Cannon Tracker",
      template: `modules/${MODULE_ID}/templates/cannon-hud.hbs`,
      width: 920,
      height: "auto",
      popOut: true,
      resizable: true
    });
  }

  getData() {
    const cannons = getCannonData();
    const cannonBalls = getNumericSetting("cannonBalls");
    const powderCharges = getNumericSetting("powderCharges");

    return {
      cannons,
      cannonBalls,
      powderCharges,
      loadedCount: cannons.filter((cannon) => cannon.enabled && cannon.loaded).length,
      enabledCount: cannons.filter((cannon) => cannon.enabled).length
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".cannon-reload").on("click", async (event) => {
      const id = Number(event.currentTarget.dataset.cannonId);
      await this._reloadCannon(id);
    });

    html.find(".cannon-fire").on("click", async (event) => {
      const id = Number(event.currentTarget.dataset.cannonId);
      await this._fireCannon(id);
    });

    html.find(".cannon-toggle-enabled").on("click", async (event) => {
      const id = Number(event.currentTarget.dataset.cannonId);
      await this._toggleCannonEnabled(id);
    });

    html.find("#cannon-reload-all").on("click", async () => {
      await this._reloadAll();
    });

    html.find("#cannon-fire-all").on("click", async () => {
      await this._fireAll();
    });

    html.find("#cannon-balls-input").on("change", async (event) => {
      await setNumericSetting("cannonBalls", Number(event.currentTarget.value));
      this.render(false);
    });

    html.find("#powder-charges-input").on("change", async (event) => {
      await setNumericSetting("powderCharges", Number(event.currentTarget.value));
      this.render(false);
    });
  }

  async _toggleCannonEnabled(id) {
    const cannons = getCannonData();
    const cannon = cannons.find((entry) => entry.id === id);
    if (!cannon) return;

    cannon.enabled = !cannon.enabled;
    await saveCannonData(cannons);
    this.render(false);
  }

  _hasAmmo(ballCount, powderCount) {
    const cannonBalls = getNumericSetting("cannonBalls");
    const powderCharges = getNumericSetting("powderCharges");

    if (cannonBalls < ballCount || powderCharges < powderCount) {
      ui.notifications.warn(
        `Not enough ammo to reload (${ballCount} balls, ${powderCount} powder required). ` +
          `Available: ${cannonBalls} balls, ${powderCharges} powder.`
      );
      return false;
    }

    return true;
  }

  async _consumeAmmo(ballCount, powderCount) {
    const cannonBalls = getNumericSetting("cannonBalls");
    const powderCharges = getNumericSetting("powderCharges");

    await setNumericSetting("cannonBalls", cannonBalls - ballCount);
    await setNumericSetting("powderCharges", powderCharges - powderCount);
  }

  async _reloadCannon(id) {
    const cannons = getCannonData();
    const cannon = cannons.find((entry) => entry.id === id);

    if (!cannon || !cannon.enabled) {
      ui.notifications.warn(`Cannon ${id} is disabled.`);
      return;
    }

    if (cannon.loaded) {
      ui.notifications.info(`Cannon ${id} is already loaded.`);
      return;
    }

    if (!this._hasAmmo(1, 1)) return;

    await this._consumeAmmo(1, 1);
    cannon.loaded = true;
    await saveCannonData(cannons);

    ui.notifications.info(`Cannon ${id} reloaded.`);
    this.render(false);
  }

  async _fireCannon(id) {
    const cannons = getCannonData();
    const cannon = cannons.find((entry) => entry.id === id);

    if (!cannon || !cannon.enabled) {
      ui.notifications.warn(`Cannon ${id} is disabled.`);
      return;
    }

    if (!cannon.loaded) {
      ui.notifications.warn(`Cannon ${id} is not loaded.`);
      return;
    }

    cannon.loaded = false;
    await saveCannonData(cannons);
    await this._postAttackRolls([cannon]);

    this.render(false);
  }

  async _reloadAll() {
    const cannons = getCannonData();
    const toReload = cannons.filter((cannon) => cannon.enabled && !cannon.loaded);

    if (!toReload.length) {
      ui.notifications.info("All enabled cannons are already loaded.");
      return;
    }

    if (!this._hasAmmo(toReload.length, toReload.length)) return;

    await this._consumeAmmo(toReload.length, toReload.length);
    toReload.forEach((cannon) => {
      cannon.loaded = true;
    });
    await saveCannonData(cannons);

    ui.notifications.info(`Reloaded ${toReload.length} cannon(s).`);
    this.render(false);
  }

  async _fireAll() {
    const cannons = getCannonData();
    const toFire = cannons.filter((cannon) => cannon.enabled && cannon.loaded);

    if (!toFire.length) {
      ui.notifications.warn("No loaded enabled cannons to fire.");
      return;
    }

    toFire.forEach((cannon) => {
      cannon.loaded = false;
    });
    await saveCannonData(cannons);
    await this._postAttackRolls(toFire);

    this.render(false);
  }

  async _postAttackRolls(cannons) {
    const attackFormula = game.settings.get(MODULE_ID, "attackFormula") || "1d20";
    const damageFormula = game.settings.get(MODULE_ID, "damageFormula") || "1d10";

    if (!Roll.validate(attackFormula) || !Roll.validate(damageFormula)) {
      ui.notifications.error("Invalid attack or damage formula in Cannon Tracker settings.");
      return;
    }

    const attackRolls = [];

    for (const cannon of cannons) {
      const roll = await (new Roll(attackFormula)).evaluate();
      attackRolls.push({ cannon, roll });
    }

    const damageRoll = await (new Roll(damageFormula)).evaluate();

    const shots = attackRolls
      .map(
        ({ cannon, roll }) =>
          `<li><strong>${foundry.utils.escapeHTML(cannon.name)}:</strong> ${roll.total} <span class="formula">(${roll.formula})</span></li>`
      )
      .join("");

    const content = `
      <div class="cannon-roll-chat">
        <h3>🔥 Cannon Volley</h3>
        <ul>${shots}</ul>
        <p><strong>Damage:</strong> ${damageRoll.total} <span class="formula">(${damageRoll.formula})</span></p>
      </div>
    `;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ alias: "Cannon Tracker" }),
      content,
      type: CONST.CHAT_MESSAGE_TYPES.ROLL,
      rolls: [...attackRolls.map(({ roll }) => roll), damageRoll]
    });
  }
}

let cannonApp;

Hooks.once("ready", async () => {
  const data = getCannonData();
  await saveCannonData(data);
});

Hooks.on("getSceneControlButtons", (controls) => {
  const tokenControls = controls.find((control) => control.name === "token");
  if (!tokenControls) return;

  tokenControls.tools.push({
    name: "open-cannon-tracker",
    title: "Open Cannon Tracker",
    icon: "fas fa-bomb",
    button: true,
    onClick: () => {
      cannonApp ??= new CannonTrackerApp();
      cannonApp.render(true);
    }
  });
});
