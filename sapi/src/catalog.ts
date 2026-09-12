/** 声明式 UI 控件目录：由 QA 模块承载开发验收入口。 */

import type { Player } from "@minecraft/server";
import { Command, debug, Permission } from "@sfmc-bds/sdk/sapi/runtime";
import { provide } from "@sfmc-bds/sdk/sapi/service";
import { ui } from "@sfmc-bds/sdk/sapi/ui";
import { catalogDemoData, catalogEcho } from "./catalog-data.js";
import featureUi from "./ui/feature.ui.json" with { type: "json" };
import homeUi from "./ui/screens/home.ui.json" with { type: "json" };
import logicUi from "./ui/screens/logic.ui.json" with { type: "json" };
import widgetsUi from "./ui/screens/widgets.ui.json" with { type: "json" };

const MODULE_ID = "qa";
let unregisterUi: (() => void) | undefined;
let unprovide: Array<() => void> = [];

export function registerCatalogCommands(): void {
  Command.register(
    "catalog",
    "qa.catalog",
    (player: Player | undefined) => {
      if (!player) {
        debug.i("QA", "catalog 必须由玩家执行");
        return;
      }
      void ui
        .openScreen(player, {
          moduleId: MODULE_ID,
          screenId: "qa.catalog.home",
        })
        .catch((error: unknown) => {
          debug.w(
            "QA",
            `打开控件目录失败: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    },
    "打开声明式 UI 控件目录",
    MODULE_ID,
  );
}

export function startCatalog(): void {
  stopCatalog();
  unprovide = [
    provide("qa.catalog.demo", () => catalogDemoData()),
    provide("qa.catalog.echo", (input) => catalogEcho(input)),
  ];
  unregisterUi = ui.registerFeature({
    feature: featureUi,
    screens: {
      "screens/home.ui.json": homeUi,
      "screens/widgets.ui.json": widgetsUi,
      "screens/logic.ui.json": logicUi,
    },
  });
}

export function stopCatalog(): void {
  unregisterUi?.();
  unregisterUi = undefined;
  for (const off of unprovide.splice(0, unprovide.length)) {
    try {
      off();
    } catch {
      /* ignore */
    }
  }
}

export function registerCatalogPermission(): void {
  Permission.register("qa.catalog", Permission.Any);
}
