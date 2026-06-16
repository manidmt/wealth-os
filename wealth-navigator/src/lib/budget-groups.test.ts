import { describe, it, expect } from "vitest";
import { BUDGET_GROUPS, groupForCategory } from "./budget-groups";
import { EXPENSE_CATEGORIES } from "./movements-api";

describe("budget-groups", () => {
  it("mapea categorías a su grupo esperado", () => {
    expect(groupForCategory("Comida")).toBe("comida");
    expect(groupForCategory("Café")).toBe("comida");
    expect(groupForCategory("Comer fuera")).toBe("ocio");
    expect(groupForCategory("Viaje")).toBe("ocio");
    expect(groupForCategory("Coche")).toBe("transporte");
    expect(groupForCategory("Suscripciones")).toBe("hogar");
    expect(groupForCategory("Gimnasio")).toBe("salud");
    expect(groupForCategory("Tecnología")).toBe("compras");
    expect(groupForCategory("Educación")).toBe("formacion");
    expect(groupForCategory("Formación")).toBe("formacion");
    expect(groupForCategory("Otro")).toBe("otros");
  });

  it("categoría desconocida cae en otros", () => {
    expect(groupForCategory("NoExiste")).toBe("otros");
    expect(groupForCategory("")).toBe("otros");
  });

  it("cubre las 23 categorías sin solapes", () => {
    const mapped = BUDGET_GROUPS.flatMap((g) => g.categories);
    expect(new Set(mapped).size).toBe(mapped.length);
    for (const cat of EXPENSE_CATEGORIES) {
      expect(mapped).toContain(cat);
    }
    for (const cat of mapped) {
      expect(EXPENSE_CATEGORIES).toContain(cat);
    }
  });
});
