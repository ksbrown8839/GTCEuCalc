package dev.gtceucalc.iconexporter;

import com.mojang.blaze3d.pipeline.RenderTarget;
import com.mojang.blaze3d.pipeline.TextureTarget;
import com.mojang.blaze3d.platform.Lighting;
import com.mojang.blaze3d.platform.NativeImage;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexSorting;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.logging.LogUtils;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.ResourceLocationArgument;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraftforge.client.event.RegisterClientCommandsEvent;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import org.joml.Matrix4f;
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
    private static final int DEFAULT_ICON_SIZE = 64;

    public GtceuCalcIconExporter() {
        MinecraftForge.EVENT_BUS.register(this);
    }

    @SubscribeEvent
    public void registerClientCommands(RegisterClientCommandsEvent event) {
        CommandDispatcher<CommandSourceStack> dispatcher = event.getDispatcher();

        dispatcher.register(Commands.literal("gtceucalc_export_icons")
            .executes(context -> exportIconManifest(context.getSource())));

        dispatcher.register(Commands.literal("gtceucalc_export_icon")
            .then(Commands.argument("item_id", ResourceLocationArgument.id())
                .executes(context -> exportSingleIcon(
                    context.getSource(),
                    ResourceLocationArgument.getId(context, "item_id")
                ))));
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

    private static int exportSingleIcon(CommandSourceStack source, ResourceLocation itemId) {
        if (!BuiltInRegistries.ITEM.containsKey(itemId)) {
            source.sendFailure(Component.literal("Item not found: " + itemId));
            return 0;
        }

        Minecraft minecraft = Minecraft.getInstance();
        Item item = BuiltInRegistries.ITEM.get(itemId);

        if (item == Items.AIR) {
            source.sendFailure(Component.literal("Item is air or empty: " + itemId));
            return 0;
        }

        ItemStack stack = new ItemStack(item);
        if (stack.isEmpty()) {
            source.sendFailure(Component.literal("Item stack was empty: " + itemId));
            return 0;
        }

        Path outputPath = minecraft.gameDirectory.toPath()
            .resolve("gtceucalc-icon-export")
            .resolve("rendered-icons")
            .resolve("items")
            .resolve(itemId.getNamespace())
            .resolve(itemId.getPath() + ".png");

        try {
            Files.createDirectories(outputPath.getParent());
            renderItemStackToPng(minecraft, stack, outputPath, DEFAULT_ICON_SIZE);
            source.sendSuccess(() -> Component.literal("Exported icon for " + itemId + " to " + outputPath), false);
            LOGGER.info("Exported icon for {} to {}", itemId, outputPath);
            return 1;
        } catch (Exception error) {
            source.sendFailure(Component.literal("Failed to export icon for " + itemId + ": " + error.getMessage()));
            LOGGER.error("Failed to export icon for {}", itemId, error);
            return 0;
        }
    }

    private static void renderItemStackToPng(Minecraft minecraft, ItemStack stack, Path outputPath, int size) throws IOException {
        RenderTarget mainTarget = minecraft.getMainRenderTarget();
        TextureTarget exportTarget = new TextureTarget(size, size, true, Minecraft.ON_OSX);

        try {
            exportTarget.setClearColor(0.0F, 0.0F, 0.0F, 0.0F);
            exportTarget.clear(Minecraft.ON_OSX);
            exportTarget.bindWrite(true);

            RenderSystem.viewport(0, 0, size, size);
            RenderSystem.enableBlend();
            RenderSystem.defaultBlendFunc();

            Matrix4f projection = new Matrix4f().setOrtho(
                0.0F, (float) size,
                (float) size, 0.0F,
                1000.0F, 3000.0F
            );
            RenderSystem.backupProjectionMatrix();
            RenderSystem.setProjectionMatrix(projection, VertexSorting.ORTHOGRAPHIC_Z);

            PoseStack modelView = RenderSystem.getModelViewStack();
            modelView.pushPose();
            modelView.setIdentity();
            modelView.translate(0.0F, 0.0F, -2000.0F);
            RenderSystem.applyModelViewMatrix();

            Lighting.setupForFlatItems();

            MultiBufferSource.BufferSource bufferSource = minecraft.renderBuffers().bufferSource();
            GuiGraphics guiGraphics = new GuiGraphics(minecraft, bufferSource);

            float scale = size / 16.0F;
            guiGraphics.pose().pushPose();
            guiGraphics.pose().scale(scale, scale, 1.0F);
            guiGraphics.renderItem(stack, 0, 0);
            guiGraphics.flush();
            guiGraphics.pose().popPose();

            NativeImage image = Screenshot.takeScreenshot(exportTarget);
            try {
                image.writeToFile(outputPath);
            } finally {
                image.close();
            }

            modelView.popPose();
            RenderSystem.applyModelViewMatrix();
            RenderSystem.restoreProjectionMatrix();
        } finally {
            mainTarget.bindWrite(true);
            RenderSystem.viewport(0, 0, mainTarget.viewWidth, mainTarget.viewHeight);
            exportTarget.destroyBuffers();
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
