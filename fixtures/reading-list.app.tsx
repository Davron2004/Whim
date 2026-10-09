// Reading List: books on three shelves. The + adds a book in a sheet; tapping a book opens it to
// move it to another shelf or remove it. Books are rows in storage, and the shelf last shown is
// a setting kept with storage.kv.
import {
  defineApp,
  Screen,
  Stack,
  Row,
  List,
  ListItem,
  EmptyState,
  Modal,
  TextInput,
  SegmentedControl,
  Button,
  toast,
  useState,
  useEffect,
  storage,
  type SchemaArtifact,
} from 'vc-sdk';

const SCHEMA: SchemaArtifact = {
  schemaVersion: 1,
  collections: {
    Books: {
      id: 'c1',
      tombstones: [],
      fields: {
        title: { id: 'f1', type: 'text' },
        author: { id: 'f2', type: 'text' },
        shelf: { id: 'f3', type: 'text' },
        added: { id: 'f4', type: 'date' },
      },
    },
  },
};

const SHELVES = ['To read', 'Reading', 'Finished'];

interface Book {
  id: number;
  title: string;
  author: string;
  shelf: string;
}

function toBook(row: { id: number; [field: string]: unknown }): Book {
  return { id: row.id, title: String(row.title ?? ''), author: String(row.author ?? ''), shelf: String(row.shelf ?? SHELVES[0]) };
}

function Shelves() {
  const [books, setBooks] = useState<Book[]>([]);
  const [shelf, setShelf] = useState(SHELVES[0]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [open, setOpen] = useState<Book | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const saved = await storage.kv.get('shelf');
      const rows = await storage.records.list('Books', { orderBy: { field: 'added', direction: 'desc' } });
      if (!live) return;
      if (typeof saved === 'string' && SHELVES.includes(saved)) setShelf(saved);
      setBooks(rows.map(toBook));
    })().catch(() => {
      if (live) toast('Couldn’t load your books.');
    });
    return () => {
      live = false;
    };
  }, []);

  const showShelf = (next: string) => {
    setShelf(next);
    storage.kv.set('shelf', next).catch(() => toast('Couldn’t save that.'));
  };

  const add = () => {
    const book = { title: title.trim(), author: author.trim(), shelf };
    storage.records
      .append('Books', { ...book, added: Date.now() })
      .then(({ id }) => {
        setBooks([{ id, ...book }, ...books]);
        setAdding(false);
        setTitle('');
        setAuthor('');
        toast(`${book.title} added`);
      })
      .catch(() => toast('Couldn’t add that book. Try again.'));
  };

  const move = (book: Book, to: string) => {
    storage.records
      .update('Books', book.id, { shelf: to })
      .then(() => {
        setBooks(books.map((b) => (b.id === book.id ? { ...b, shelf: to } : b)));
        setOpen({ ...book, shelf: to });
      })
      .catch(() => toast('Couldn’t move that book.'));
  };

  const remove = (book: Book) => {
    storage.records
      .remove('Books', book.id)
      .then(() => {
        setBooks(books.filter((b) => b.id !== book.id));
        setOpen(null);
        toast(`${book.title} removed`);
      })
      .catch(() => toast('Couldn’t remove that book.'));
  };

  const shown = books.filter((b) => b.shelf === shelf);

  return (
    <Screen title="Reading List" action={{ icon: 'plus', label: 'Add a book', onPress: () => setAdding(true) }}>
      <Stack gap="lg">
        <SegmentedControl options={SHELVES} value={shelf} onChange={showShelf} />
        {shown.length === 0 ? (
          <EmptyState icon="book-open" title={`Nothing in ${shelf}`} hint="Tap + to add a book." />
        ) : (
          <List
            items={shown}
            keyBy="id"
            renderItem={(book) => <ListItem title={book.title} subtitle={book.author} icon="book" onPress={() => setOpen(book)} />}
          />
        )}
      </Stack>

      <Modal visible={adding} title="Add a book" onClose={() => setAdding(false)}>
        <TextInput label="Title" value={title} onChange={setTitle} />
        <TextInput label="Author" value={author} placeholder="Optional" onChange={setAuthor} />
        <Button label={`Add to ${shelf}`} disabled={title.trim() === ''} onPress={add} />
      </Modal>

      <Modal visible={open !== null} title={open?.title} onClose={() => setOpen(null)}>
        {open && (
          <Stack gap="lg">
            <SegmentedControl options={SHELVES} value={open.shelf} onChange={(to) => move(open, to)} />
            <Row>
              <Button label="Remove" variant="danger" icon="trash-2" onPress={() => remove(open)} />
              <Button label="Done" variant="secondary" onPress={() => setOpen(null)} />
            </Row>
          </Stack>
        )}
      </Modal>
    </Screen>
  );
}

export default defineApp({
  name: 'Reading List',
  initial: 'Shelves',
  screens: { Shelves },
  capabilities: ['storage'],
  schema: SCHEMA,
  tint: ['berry', 'rose', 'orchid'],
  icon: 'book-open',
});
