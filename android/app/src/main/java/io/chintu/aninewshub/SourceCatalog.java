package io.chintu.aninewshub;

import java.util.Arrays;
import java.util.List;

public final class SourceCatalog {
    public static final class Source {
        public final String id;
        public final String name;

        Source(String id, String name) {
            this.id = id;
            this.name = name;
        }
    }

    public static final List<Source> SOURCES = Arrays.asList(
            new Source("sankaku", "Sankaku Complex"),
            new Source("soranews24", "SoraNews24"),
            new Source("ann", "Anime News Network"),
            new Source("crunchyroll", "Crunchyroll News"),
            new Source("mal", "MyAnimeList"),
            new Source("billboardjapan", "Billboard JAPAN"),
            new Source("barks", "BARKS"),
            new Source("ototoy", "OTOTOY")
    );

    private SourceCatalog() {}
}
