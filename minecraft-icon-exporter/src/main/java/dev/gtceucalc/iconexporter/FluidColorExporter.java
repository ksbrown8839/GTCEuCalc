package dev.gtceucalc.iconexporter;

import com.mojang.logging.LogUtils;
import net.minecraft.client.Minecraft;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.level.material.Fluid;
import net.minecraft.world.level.material.Fluids;
import net.minecraftforge.client.event.RegisterClientCommandsEvent;
import net.minecraftforge.client.extensions.common.IClientFluidTypeExtensions;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.registries.ForgeRegistries;
import org.slf4j.Logger;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

@Mod.EventBusSubscriber(modid = GtceuCalcIconExporter.MOD_ID, bus = Mod.EventBusSubscriber.Bus.FORGE)
public final class FluidColorExporter {
    private static final Logger LOGGER = LogUtils.getLogger();

    private FluidColorExporter() {}

    @SubscribeEvent
    public static void registerClientCommands(RegisterClientCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("gtceucalc_export_fluid_colors")
            .executes(context -> exportFluidColors(context.getSource())));
    }

    private static int exportFluidColors(CommandSourceStack source) {
        Minecraft minecraft = Minecraft.getInstance();
        Path outputRoot = minecraft.gameDirectory.toPath().resolve("gtceucalc-icon-export");
        Path outputPath = outputRoot.resolve("fluid-colors.local.json");

        try {
            Files.createDirectories(outputRoot);
            List<FluidColorEntry> entries = collectFluidColorEntries();
            Files.writeString(outputPath, buildManifest(entries), StandardCharsets.UTF_8);
            source.sendSuccess(() -> Component.literal("Exported " + entries.size() + " fluid colors to " + outputPath), false);
            LOGGER.info("Exported {} fluid colors to {}", entries.size(), outputPath);
            return entries.size();
        } catch (IOException error) {
            source.sendFailure(Component.literal("GTCEuCalc fluid color export failed: " + error.getMessage()));
            LOGGER.error("GTCEuCalc fluid color export failed", error);
            return 0;
        }
    }

    private static List<FluidColorEntry> collectFluidColorEntries() {
        List<FluidColorEntry> entries = new ArrayList<>();

        for (Fluid fluid : ForgeRegistries.FLUIDS.getValues()) {
            ResourceLocation id = ForgeRegistries.FLUIDS.getKey(fluid);
            if (id == null || fluid == Fluids.EMPTY) continue;

            IClientFluidTypeExtensions clientExtensions = IClientFluidTypeExtensions.of(fluid);
            int argb = clientExtensions.getTintColor();
            ResourceLocation stillTexture = clientExtensions.getStillTexture();
            ResourceLocation flowingTexture = clientExtensions.getFlowingTexture();
            ResourceLocation overlayTexture = clientExtensions.getOverlayTexture();

            entries.add(new FluidColorEntry(
                id.toString(),
                toArgbHex(argb),
                toRgbHex(argb),
                (argb >>> 24) & 0xFF,
                stillTexture == null ? null : stillTexture.toString(),
                flowingTexture == null ? null : flowingTexture.toString(),
                overlayTexture == null ? null : overlayTexture.toString()
            ));
        }

        entries.sort(Comparator.comparing(FluidColorEntry::id));
        return entries;
    }

    private static String buildManifest(List<FluidColorEntry> entries) {
        StringBuilder builder = new StringBuilder();
        builder.append("{\n");
        builder.append("  \"schema\": \"gtceu-fluid-colors-v1\",\n");
        builder.append("  \"generatedAt\": \"").append(escapeJson(Instant.now().toString())).append("\",\n");
        builder.append("  \"fluids\": {\n");

        for (int index = 0; index < entries.size(); index += 1) {
            FluidColorEntry entry = entries.get(index);
            builder.append("    \"").append(escapeJson(entry.id())).append("\": { ");
            builder.append("\"argb\": \"").append(entry.argb()).append("\", ");
            builder.append("\"rgb\": \"").append(entry.rgb()).append("\", ");
            builder.append("\"alpha\": ").append(entry.alpha());
            appendOptionalString(builder, "stillTexture", entry.stillTexture());
            appendOptionalString(builder, "flowingTexture", entry.flowingTexture());
            appendOptionalString(builder, "overlayTexture", entry.overlayTexture());
            builder.append(" }");
            if (index + 1 < entries.size()) builder.append(",");
            builder.append("\n");
        }

        builder.append("  }\n");
        builder.append("}\n");
        return builder.toString();
    }

    private static void appendOptionalString(StringBuilder builder, String key, String value) {
        if (value == null) return;
        builder.append(", \"").append(escapeJson(key)).append("\": \"").append(escapeJson(value)).append("\"");
    }

    private static String toArgbHex(int argb) {
        return String.format("#%08X", argb);
    }

    private static String toRgbHex(int argb) {
        return String.format("#%06X", argb & 0xFFFFFF);
    }

    private static String escapeJson(String value) {
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\b", "\\b")
            .replace("\f", "\\f")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t");
    }

    private record FluidColorEntry(
        String id,
        String argb,
        String rgb,
        int alpha,
        String stillTexture,
        String flowingTexture,
        String overlayTexture
    ) {}
}
