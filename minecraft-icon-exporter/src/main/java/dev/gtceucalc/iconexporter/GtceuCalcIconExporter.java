package dev.gtceucalc.iconexporter;

import com.mojang.blaze3d.pipeline.RenderTarget;
import com.mojang.blaze3d.pipeline.TextureTarget;
import com.mojang.blaze3d.platform.Lighting;
import com.mojang.blaze3d.platform.NativeImage;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexSorting;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
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
import net.minecraftforge.event.TickEvent;
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
    private static final int ICONS_PER_CLIENT_TICK = 12;
    private static ExportJob activeExportJob = null;

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

        dispatcher.register(Commands.literal("gtceucalc_export_icons_sample")
            .then(Commands.argument("count", IntegerArgumentType.integer(1, 1000))
                .executes(context -> scheduleIconBatch(
                    context.getSource(),
                    collectItemExportEntries(),
                    IntegerArgumentType.getInteger(context, "count"),
                    "sample"
                ))));

        dispatcher.register(Commands.literal("gtceucalc_export_icons_all")
            .executes(context -> {
                List<ItemExportEntry> entries = collectItemExportEntries();
                return scheduleIconBatch(context.getSource(), entries, entries.size(), "all");
            }));
    }

    @SubscribeEvent
    public void onClientTick(TickEvent.ClientTickEvent event) {
        if (event.phase != TickEvent.Phase.END || activeExportJob == null) return;

        Minecraft minecraft = Minecraft.getInstance();
        ExportJob job = activeExportJob;
        int processedThisTick = 0;

        while (processedThisTick < ICONS_PER_CLIENT_TICK && job.index() < job.entries().size()) {
            ItemExportEntry entry = job.entries().get(job.index());
            job.advanceIndex();
            processedThisTick += 1;

            ItemStack stack = new ItemStack(entry.item());
            if (stack.isEmpty()) continue;

            Path outputPath = outputPathForItem(minecraft, entry.id());
            try {
                Files.createDirectories(outputPath.getParent());
                renderItemStackToPng(minecraft, stack, outputPath, DEFAULT_ICON_SIZE);
                job.incrementExported();
            } catch (Exception error) {
                job.incrementFailed();
                LOGGER.warn("Failed to export icon for {}", entry.id(), error);
            }
        }

        if (job.index() % 250 == 0 || job.index() >= job.entries().size()) {
            sendClientMessage("GTCEuCalc icon export progress: " + job.index() + " / " + job.entries().size()
                + " exported=" + job.exported() + " failed=" + job.failed());
        }

        if (job.index() >= job.entries().size()) {
            sendClientMessage("Finished GTCEuCalc icon export (" + job.label() + "): exported="
                + job.exported() + " failed=" + job.failed());
            activeExportJob = null;
        }
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
        Item item = itemForId(source, itemId);
        if (item == null) return 0;

        Minecraft minecraft = Minecraft.getInstance();
        ItemStack stack = new ItemStack(item);
        if (stack.isEmpty()) {
            source.sendFailure(Component.literal("Item stack was empty: " + itemId));
            return 0;
        }

        Path outputPath = outputPathForItem(minecraft, itemId);

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

    private static int scheduleIconBatch(CommandSourceStack source, List<ItemExportEntry> entries, int requestedLimit, String label) {
        if (activeExportJob != null) {
            source.sendFailure(Component.literal("A GTCEuCalc icon export is already running."));
            return 0;
        }

        int limit = Math.min(requestedLimit, entries.size());
        List<ItemExportEntry> limitedEntries = new ArrayList<>(entries.subList(0, limit));
        activeExportJob = new ExportJob(label, limitedEntries);

        source.sendSuccess(() -> Component.literal("Scheduled GTCEuCalc icon export (" + label + "): "
            + limitedEntries.size() + " items at " + ICONS_PER_CLIENT_TICK + " icons/client tick"), false);
        LOGGER.info("Scheduled GTCEuCalc icon export ({}): {} items", label, limitedEntries.size());
        return limitedEntries.size();
    }

    private static Item itemForId(CommandSourceStack source, ResourceLocation itemId) {
        if (!BuiltInRegistries.ITEM.containsKey(itemId)) {
            source.sendFailure(Component.literal("Item not found: " + itemId));
            return null;
        }

        Item item = BuiltInRegistries.ITEM.get(itemId);
        if (item == Items.AIR) {
            source.sendFailure(Component.literal("Item is air or empty: " + itemId));
            return null;
        }

        return item;
    }

    private static Path outputPathForItem(Minecraft minecraft, ResourceLocation itemId) {
        return minecraft.gameDirectory.toPath()
            .resolve("gtceucalc-icon-export")
            .resolve("rendered-icons")
            .resolve("items")
            .resolve(itemId.getNamespace())
            .resolve(itemId.getPath() + ".png");
    }

    private static void sendClientMessage(String message) {
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft.player != null) {
            minecraft.player.displayClientMessage(Component.literal(message), false);
        }
        LOGGER.info(message);
    }

    private static void renderItemStackToPng(Minecraft minecraft, ItemStack stack, Path outputPath, int size) throws IOException {
        NativeImage blackImage = renderItemStackToImage(minecraft, stack, size, 0.0F, 0.0F, 0.0F);
        NativeImage whiteImage = renderItemStackToImage(minecraft, stack, size, 1.0F, 1.0F, 1.0F);
        NativeImage outputImage = null;

        try {
            outputImage = reconstructAlphaFromBlackAndWhiteRenders(blackImage, whiteImage);
            outputImage.writeToFile(outputPath);
        } finally {
            blackImage.close();
            whiteImage.close();
            if (outputImage != null) outputImage.close();
        }
    }

    private static NativeImage renderItemStackToImage(Minecraft minecraft, ItemStack stack, int size, float red, float green, float blue) {
        RenderTarget mainTarget = minecraft.getMainRenderTarget();
        TextureTarget exportTarget = new TextureTarget(size, size, true, Minecraft.ON_OSX);
        boolean projectionBackedUp = false;
        boolean modelViewPushed = false;

        try {
            exportTarget.setClearColor(red, green, blue, 1.0F);
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
            projectionBackedUp = true;
            RenderSystem.setProjectionMatrix(projection, VertexSorting.ORTHOGRAPHIC_Z);

            PoseStack modelView = RenderSystem.getModelViewStack();
            modelView.pushPose();
            modelViewPushed = true;
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

            return Screenshot.takeScreenshot(exportTarget);
        } finally {
            PoseStack modelView = RenderSystem.getModelViewStack();
            if (modelViewPushed) {
                modelView.popPose();
                RenderSystem.applyModelViewMatrix();
            }
            if (projectionBackedUp) {
                RenderSystem.restoreProjectionMatrix();
            }
            mainTarget.bindWrite(true);
            RenderSystem.viewport(0, 0, mainTarget.viewWidth, mainTarget.viewHeight);
            exportTarget.destroyBuffers();
        }
    }

    private static NativeImage reconstructAlphaFromBlackAndWhiteRenders(NativeImage blackImage, NativeImage whiteImage) {
        int width = blackImage.getWidth();
        int height = blackImage.getHeight();
        NativeImage outputImage = new NativeImage(width, height, false);

        for (int y = 0; y < height; y += 1) {
            for (int x = 0; x < width; x += 1) {
                int black = blackImage.getPixelRGBA(x, y);
                int white = whiteImage.getPixelRGBA(x, y);

                int blackRed = red(black);
                int blackGreen = green(black);
                int blackBlue = blue(black);
                int whiteRed = red(white);
                int whiteGreen = green(white);
                int whiteBlue = blue(white);

                int diffRed = clamp(whiteRed - blackRed, 0, 255);
                int diffGreen = clamp(whiteGreen - blackGreen, 0, 255);
                int diffBlue = clamp(whiteBlue - blackBlue, 0, 255);
                int backgroundInfluence = Math.max(diffRed, Math.max(diffGreen, diffBlue));
                int alpha = 255 - backgroundInfluence;

                if (alpha <= 0) {
                    outputImage.setPixelRGBA(x, y, rgba(0, 0, 0, 0));
                } else {
                    int red = clamp((blackRed * 255 + alpha / 2) / alpha, 0, 255);
                    int green = clamp((blackGreen * 255 + alpha / 2) / alpha, 0, 255);
                    int blue = clamp((blackBlue * 255 + alpha / 2) / alpha, 0, 255);
                    outputImage.setPixelRGBA(x, y, rgba(red, green, blue, alpha));
                }
            }
        }

        return outputImage;
    }

    private static int red(int color) {
        return color & 0xFF;
    }

    private static int green(int color) {
        return (color >>> 8) & 0xFF;
    }

    private static int blue(int color) {
        return (color >>> 16) & 0xFF;
    }

    private static int rgba(int red, int green, int blue, int alpha) {
        return ((alpha & 0xFF) << 24)
            | ((blue & 0xFF) << 16)
            | ((green & 0xFF) << 8)
            | (red & 0xFF);
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
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

    private static List<ItemExportEntry> collectItemExportEntries() {
        List<ItemExportEntry> entries = new ArrayList<>();
        for (Item item : BuiltInRegistries.ITEM) {
            ResourceLocation id = BuiltInRegistries.ITEM.getKey(item);
            if (id == null || item == Items.AIR) continue;
            ItemStack stack = new ItemStack(item);
            if (stack.isEmpty()) continue;
            entries.add(new ItemExportEntry(id, item));
        }
        entries.sort(Comparator.comparing(entry -> entry.id().toString()));
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

    private record ItemExportEntry(ResourceLocation id, Item item) {}

    private static final class ExportJob {
        private final String label;
        private final List<ItemExportEntry> entries;
        private int index = 0;
        private int exported = 0;
        private int failed = 0;

        private ExportJob(String label, List<ItemExportEntry> entries) {
            this.label = label;
            this.entries = entries;
        }

        private String label() { return label; }
        private List<ItemExportEntry> entries() { return entries; }
        private int index() { return index; }
        private int exported() { return exported; }
        private int failed() { return failed; }
        private void advanceIndex() { index += 1; }
        private void incrementExported() { exported += 1; }
        private void incrementFailed() { failed += 1; }
    }
}
