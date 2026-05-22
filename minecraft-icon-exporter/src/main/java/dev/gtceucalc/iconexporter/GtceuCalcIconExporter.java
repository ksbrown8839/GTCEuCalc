package dev.gtceucalc.iconexporter;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.logging.LogUtils;
import net.minecraft.client.Minecraft;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.client.event.RegisterClientCommandsEvent;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import org.slf4j.Logger;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

@Mod(GtceuCalcIconExporter.MOD_ID)
public final class GtceuCalcIconExporter {
    public static final String MOD_ID = "gtceucalc_icon_exporter";
    private static final Logger LOGGER = LogUtils.getLogger();

    public GtceuCalcIconExporter() {
        MinecraftForge.EVENT_BUS.register(this);
    }

    @SubscribeEvent
    public void registerClientCommands(RegisterClientCommandsEvent event) {
        CommandDispatcher<CommandSourceStack> dispatcher = event.getDispatcher();
        dispatcher.register(Commands.literal("gtceucalc_export_icons")
            .executes(context -> exportIconManifest(context.getSource())));
    }

    private static int exportIconManifest(CommandSourceStack source) {
        Minecraft minecraft = Minecraft.getInstance();
        Path gameDirectory = minecraft.gameDirectory.toPath();
        Path outputRoot = gameDirectory.resolve("gtceucalc-icon-export");
        Path manifestPath = outputRoot.resolve("rendered-icons.local.json");

        try {
            Files.createDirectories(outputRoot);
            List<IconEntry> entries = collectItemEntries();
            String manifest = buildManifest(entries);
            Files.writeString(manifestPath, manifest, StandardCharsets.UTF_8);
            source.sendSuccess(() -> Component.literal("Exported " + entries.size() + " item ids to " + manifestPath), false);
            LOGGER.info("Exported {} item ids to {}", entries.size(), manifestPath);
            return entries.size();
        } catch (IOException error) {
            source.sendFailure(Component.literal("GTCEuCalc icon manifest export failed: " + error.getMessage()));
            LOGGER.error("GTCEuCalc icon manifest export failed", error);
            return 0;
        }
    }

    private static List<IconEntry> collectItemEntries() {
        List<IconEntry> entries = new ArrayList<>();
        for (Item item : BuiltInRegistries.ITEM) {
            ResourceLocation id = BuiltInRegistries.ITEM.getKey(item);
            if (id == null) continue;
            ItemStack stack = new ItemStack(item);
            if (stack.isEmpty()) continue;
            entries.add(new IconEntry(id.toString(), iconPathFor(id)));
        }
        entries.sort(Comparator.comparing(IconEntry::goodsId));
        return entries;
    }

    private static String iconPathFor(ResourceLocation id) {
        return "rendered-icons/items/" + id.getNamespace() + "/" + id.getPath() + ".png";
    }

    private static String buildManifest(List<IconEntry> entries) {
        StringBuilder builder = new StringBuilder();
        builder.append("{\n");
        builder.append("  \"schema\": \"gtceu-rendered-icons-v1\",\n");
        builder.append("  \"generatedAt\": \"").append(escapeJson(Instant.now().toString())).append("\",\n");
        builder.append("  \"iconSize\": 64,\n");
        builder.append("  \"icons\": {\n");
        for (int index = 0; index < entries.size(); index += 1) {
            IconEntry entry = entries.get(index);
            builder.append("    \"").append(escapeJson(entry.goodsId())).append("\": ");
            builder.append("\"").append(escapeJson(entry.path())).append("\"");
            if (index + 1 < entries.size()) builder.append(",");
            builder.append("\n");
        }
        builder.append("  }\n");
        builder.append("}\n");
        return builder.toString();
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

    private record IconEntry(String goodsId, String path) {}
}
