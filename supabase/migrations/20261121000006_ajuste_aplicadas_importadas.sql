-- Las ventas importadas de la hoja que ya estaban aplicadas no tienen fecha real de aplicación:
-- se deja vacía en lugar de la fecha de la migración anterior.
update venta_pagos set aplicado_en = null where aplicado_por is null;
